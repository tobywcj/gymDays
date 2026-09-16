"use client";

import { useRef, useState } from "react";
import { T } from "@/lib/design-tokens";
import AgentPipeline from "./AgentPipeline";
import type { ChatTurn, AgentName, ProgressReport, Program, MealPlan } from "./AgentMessage";
import type { StreamEvent } from "@/lib/useAgentStream";

type Activity = {
  id: string;
  started_at: string;
  type: string | null;
  duration_s: number | null;
};

type ChatData = {
  progressReport: ProgressReport | null;
  program: Program | null;
  mealPlan: MealPlan | null;
};

type Props = {
  clientId: string;
  stravaConnected: boolean;
  lastMessageAt: string | null;
  initialProgressReport: ProgressReport | null;
  initialProgram: Program | null;
  initialMealPlan: MealPlan | null;
  activities: Activity[];
};

function makeTurnId() {
  return Math.random().toString(36).slice(2);
}

function computePulse(activities: Activity[]) {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  const thisWeek = activities.filter((a) => new Date(a.started_at) >= monday);
  const sessions = thisWeek.length;

  const fourWeeksAgo = new Date(monday);
  fourWeeksAgo.setDate(monday.getDate() - 28);
  const prevActivities = activities.filter((a) => {
    const d = new Date(a.started_at);
    return d >= fourWeeksAgo && d < monday;
  });
  const thisWeekDuration = thisWeek.reduce((s, a) => s + (a.duration_s ?? 0), 0);
  const prevAvgDuration = prevActivities.length > 0
    ? prevActivities.reduce((s, a) => s + (a.duration_s ?? 0), 0) / 4
    : 0;
  const loadPct = prevAvgDuration > 0
    ? Math.round(((thisWeekDuration - prevAvgDuration) / prevAvgDuration) * 100)
    : null;

  return { sessions, loadPct };
}

async function fetchChatData(clientId: string): Promise<ChatData> {
  const r = await fetch(`/api/client/${clientId}/chat-data`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

const STREAM_URL: Record<AgentName, (id: string) => string> = {
  progress:  (id) => `/api/ai/progress/${id}/stream`,
  planner:   (id) => `/api/ai/planning/${id}/stream`,
  nutrition: (id) => `/api/ai/nutrition/${id}/stream`,
  messaging: (id) => `/api/ai/flow/weekly-checkin/${id}/stream`,
};

// Tiny inline SSE reader. Calls onEvent for each parsed event and resolves
// when the stream emits {type:"done"} (or the connection closes).
async function streamAgent(
  url: string,
  body: Record<string, unknown>,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok || !r.body) {
    const text = await r.text().catch(() => "");
    throw new Error(`${r.status}: ${text}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (!payload) continue;
      try {
        const ev = JSON.parse(payload) as StreamEvent;
        onEvent(ev);
        if (ev.type === "done") return;
      } catch { /* malformed frame — skip */ }
    }
  }
}

export default function ClientChat({
  clientId,
  stravaConnected,
  lastMessageAt,
  initialProgressReport,
  initialProgram,
  initialMealPlan,
  activities,
}: Props) {
  const { sessions, loadPct } = computePulse(activities);

  const [turns, setTurns] = useState<ChatTurn[]>(() => {
    const initial: ChatTurn[] = [];
    if (initialProgressReport) {
      initial.push({
        id: makeTurnId(),
        agent: "progress",
        status: "done",
        progressReport: initialProgressReport,
        sessionsThisWeek: sessions,
        loadPct: loadPct ?? undefined,
        timestamp: Date.now(),
      });
    }
    if (initialProgram) {
      initial.push({
        id: makeTurnId(),
        agent: "planner",
        status: "done",
        program: initialProgram,
        timestamp: Date.now(),
      });
    }
    if (initialMealPlan) {
      initial.push({
        id: makeTurnId(),
        agent: "nutrition",
        status: "done",
        mealPlan: initialMealPlan,
        timestamp: Date.now(),
      });
    }
    return initial;
  });

  const abortRef = useRef<AbortController | null>(null);

  function updateTurn(id: string, patch: Partial<ChatTurn>) {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function appendThought(id: string, line: string) {
    setTurns((prev) => prev.map((t) => {
      if (t.id !== id) return t;
      const next = [...(t.thoughts ?? []), line];
      return { ...t, thoughts: next };
    }));
  }

  function appendSource(id: string, title: string, url: string) {
    setTurns((prev) => prev.map((t) => {
      if (t.id !== id) return t;
      if ((t.sources ?? []).some((s) => s.url === url)) return t;
      return { ...t, sources: [...(t.sources ?? []), { title, url }] };
    }));
  }

  async function triggerAgent(agent: AgentName) {
    const id = makeTurnId();
    setTurns((prev) => [
      ...prev,
      { id, agent, status: "running", thoughts: [], timestamp: Date.now() },
    ]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const resultBox: { value: Record<string, unknown> | null } = { value: null };
    try {
      await streamAgent(STREAM_URL[agent](clientId), {}, (ev) => {
        if (ev.type === "thought") appendThought(id, ev.line);
        else if (ev.type === "source") appendSource(id, ev.title, ev.url);
        else if (ev.type === "result") resultBox.value = ev.payload;
        else if (ev.type === "error") throw new Error(ev.message);
      }, ctrl.signal);

      if (agent === "messaging") {
        const payload = resultBox.value;
        const body =
          (payload?.body as string | undefined) ??
          ((payload?.summary as Record<string, unknown> | undefined)?.body as string | undefined);
        updateTurn(id, { status: "done", messageDraft: body });
        return;
      }

      const data = await fetchChatData(clientId);
      updateTurn(id, {
        status: "done",
        progressReport: agent === "progress" ? (data.progressReport ?? undefined) : undefined,
        program:        agent === "planner"  ? (data.program ?? undefined) : undefined,
        mealPlan:       agent === "nutrition"? (data.mealPlan ?? undefined) : undefined,
        sessionsThisWeek: agent === "progress" ? sessions : undefined,
        loadPct:          agent === "progress" ? (loadPct ?? undefined) : undefined,
      });
    } catch (e) {
      updateTurn(id, { status: "error", errorMsg: (e as Error).message });
    }
  }

  async function triggerMessaging() {
    return triggerAgent("messaging");
  }

  function handleRun(agent: AgentName) {
    if (agent === "messaging") {
      triggerMessaging();
    } else {
      triggerAgent(agent);
    }
  }

  function handleDismissFlags() {
    setTurns((prev) => prev.map((t) => {
      if (t.agent === "progress" && t.progressReport) {
        return { ...t, progressReport: { ...t.progressReport, flags: [] } };
      }
      return t;
    }));
  }

  const isRunning = turns.some((t) => t.status === "running");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Status strip */}
      <div style={{
        display: "flex", gap: 16, alignItems: "center",
        fontSize: 11, color: T.muted, flexWrap: "wrap",
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: stravaConnected ? "#4ade80" : T.border,
            display: "inline-block",
          }} />
          Strava {stravaConnected ? "connected" : "not connected"}
        </span>
        {lastMessageAt && (
          <>
            <span style={{ color: T.border }}>·</span>
            <span>Last message {new Date(lastMessageAt).toLocaleDateString()}</span>
          </>
        )}
      </div>

      {/* Agent pipeline */}
      <AgentPipeline
        turns={turns}
        isRunning={isRunning}
        clientId={clientId}
        onRun={handleRun}
        onSendFoodGuide={triggerMessaging}
        onDismissFlags={handleDismissFlags}
      />
    </div>
  );
}
