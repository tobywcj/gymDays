"use client";

import { useCallback, useRef, useState } from "react";

export type StreamSource = { title: string; url: string };

export type StreamEvent =
  | { type: "start"; run_id: string }
  | { type: "thought"; line: string }
  | { type: "source"; title: string; url: string }
  | { type: "result"; payload: Record<string, unknown> }
  | { type: "error"; message: string; code?: string }
  | { type: "done" };

export type StreamState = {
  running: boolean;
  thoughts: string[];
  sources: StreamSource[];   // data sources surfaced live during the run
  result: Record<string, unknown> | null;
  error: string | null;
  // Machine-readable error code (e.g. "quota_exhausted" → free model out of
  // quota; the UI offers a one-click retry on the trainer's paid API).
  errorCode: string | null;
};

const INITIAL: StreamState = { running: false, thoughts: [], sources: [], result: null, error: null, errorCode: null };

// Parses a chunk of SSE text into JSON events. Tolerates partial frames by
// caching the leftover tail between calls.
function makeSseParser() {
  let buf = "";
  return function parse(chunk: string): StreamEvent[] {
    buf += chunk;
    const events: StreamEvent[] = [];
    let idx: number;
    // SSE frames are separated by "\n\n".
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (!payload) continue;
      try {
        events.push(JSON.parse(payload) as StreamEvent);
      } catch {
        /* drop malformed frame */
      }
    }
    return events;
  };
}

export function useAgentStream() {
  const [state, setState] = useState<StreamState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  // Remember the last request so retry() can re-run it with a model override
  // (the one-click "use my paid API for this run" fallback).
  const lastReq = useRef<{ url: string; body: Record<string, unknown>; onEvent?: (ev: StreamEvent) => void } | null>(null);

  const start = useCallback(async (
    url: string,
    body: Record<string, unknown> = {},
    onEvent?: (ev: StreamEvent) => void,
  ): Promise<Record<string, unknown> | null> => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    lastReq.current = { url, body, onEvent };
    setState({ running: true, thoughts: [], sources: [], result: null, error: null, errorCode: null });

    let finalResult: Record<string, unknown> | null = null;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!r.ok || !r.body) {
        const text = await r.text().catch(() => "");
        throw new Error(`${r.status}: ${text}`);
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      const parse = makeSseParser();

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const events = parse(decoder.decode(value, { stream: true }));
        for (const ev of events) {
          onEvent?.(ev);
          if (ev.type === "thought") {
            setState((s) => ({ ...s, thoughts: [...s.thoughts, ev.line] }));
          } else if (ev.type === "source") {
            // Accumulate live, de-duping by URL so repeated searches don't pile up.
            setState((s) => (s.sources.some((x) => x.url === ev.url)
              ? s
              : { ...s, sources: [...s.sources, { title: ev.title, url: ev.url }] }));
          } else if (ev.type === "result") {
            finalResult = ev.payload;
            setState((s) => ({ ...s, result: ev.payload }));
          } else if (ev.type === "error") {
            setState((s) => ({ ...s, error: ev.message, errorCode: ev.code ?? null }));
          } else if (ev.type === "done") {
            setState((s) => ({ ...s, running: false }));
            return finalResult;
          }
        }
      }
    } catch (e) {
      const msg = (e as Error).message;
      setState((s) => ({ ...s, error: msg, running: false }));
      throw e;
    } finally {
      setState((s) => ({ ...s, running: false }));
    }
    return finalResult;
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) => ({ ...s, running: false }));
  }, []);

  // Re-run the last request, merging overrides into the body — used for the
  // one-click paid fallback: retry({ llm_model: "anthropic/…" }).
  const retry = useCallback((
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, unknown> | null> => {
    const prev = lastReq.current;
    if (!prev) return Promise.resolve(null);
    return start(prev.url, { ...prev.body, ...overrides }, prev.onEvent);
  }, [start]);

  return { ...state, start, stop, retry };
}

export type AgentStream = ReturnType<typeof useAgentStream>;
