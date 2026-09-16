"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";
import Spinner from "./Spinner";
import ThoughtLine, { plainThought } from "./ThoughtLine";
import LiveSources from "./LiveSources";
import { useAgentStream } from "@/lib/useAgentStream";
import PaidRetry from "./PaidRetry";

type Props = {
  clientId: string;
  llms: { default: string; models: Record<string, string>; keys: { openai: boolean; anthropic: boolean } } | null;
};

const SAMPLE = `Hi! I'm Alex, 32, looking to lose around 8kg before my sister's wedding in 4 months. I have adjustable dumbbells up to 24kg and a pull-up bar at home. I can train Monday, Wednesday and Friday evenings around 6pm. I had a lower-back injury two years ago — mostly healed but I'd like to avoid heavy loaded flexion. Also lactose intolerant.`;

export default function OnboardingAgentForm({ clientId, llms }: Props) {
  const router = useRouter();
  const stream = useAgentStream();
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const busy = stream.running;
  const latestThought = stream.thoughts[stream.thoughts.length - 1];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    try {
      const payload = await stream.start(`/api/ai/onboarding/${clientId}/stream`, {
        transcript,
      });
      if (payload) setResult(payload);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!llms) {
    return (
      <div className="glass" data-testid="ai-service-down" style={{ borderRadius: T.radius.card, padding: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Onboarding Agent</div>
        <div style={{ fontSize: 12, color: T.muted }}>
          AI service unreachable. Start it with{" "}
          <code style={{ fontFamily: T.font.mono, color: T.accent }}>cd ai && uvicorn main:app --port 8001</code>
          {" "}then reload.
        </div>
      </div>
    );
  }

  return (
    <div className="glass glass-tint-ochre" style={{ borderRadius: T.radius.card, padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 180px" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Onboarding Agent</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
            Paste an intake transcript → CrewAI extracts profile + seeds memory.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setTranscript(SAMPLE)}
          style={{
            fontSize: 11, color: T.accent, background: "none", border: "none", cursor: "pointer",
            flexShrink: 0, whiteSpace: "nowrap",
          }}
        >
          Use sample
        </button>
      </div>

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11, color: T.muted }}>
          Transcript
          <textarea
            data-testid="transcript"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={6}
            required
            placeholder="Paste the client's intake answers here…"
            style={{
              background: "rgba(0,0,0,0.25)",
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              padding: "10px 12px",
              color: T.text,
              fontFamily: T.font.sans,
              fontSize: 13,
              outline: "none",
              resize: "vertical",
            }}
          />
        </label>

        <button
          type="submit"
          disabled={busy || !transcript.trim()}
          data-testid="run-agent"
          style={{
            alignSelf: "flex-start",
            background: "linear-gradient(135deg, rgba(196,148,82,0.95) 0%, rgba(140,92,48,0.95) 100%)",
            border: "1px solid rgba(255,252,245,0.25)",
            borderRadius: 99,
            padding: "9px 18px",
            color: "#fffdf6",
            fontSize: 13,
            fontWeight: 600,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.7 : 1,
            boxShadow: "0 1px 0 rgba(255,252,245,0.45) inset, 0 6px 20px rgba(140,92,48,0.45)",
          }}
        >
          {busy ? <Spinner emoji="👤" label={plainThought(latestThought) ?? "Running…"} /> : "Run Onboarding Agent"}
        </button>

        {busy && <LiveSources sources={stream.sources} />}

        {busy && stream.thoughts.length > 0 && (
          <div
            data-testid="onboarding-thoughts"
            style={{
              display: "flex", flexDirection: "column", gap: 4,
              padding: "8px 12px", background: "rgba(0,0,0,0.18)",
              borderRadius: 8, borderLeft: `2px solid ${T.border}`,
              maxHeight: 140, overflowY: "auto",
            }}
          >
            {stream.thoughts.map((line, i) => (
              <div key={i} style={{
                fontSize: 11, color: T.muted, lineHeight: 1.45,
                fontFamily: T.font.mono,
                opacity: i === stream.thoughts.length - 1 ? 1 : 0.55,
              }}>
                <ThoughtLine line={line} />
              </div>
            ))}
          </div>
        )}

        <PaidRetry stream={stream} />

        {error && (
          <div data-testid="agent-error" style={{ fontSize: 11, color: "#f87171", fontFamily: T.font.mono }}>
            {error}
          </div>
        )}

        {!busy && result && (
          <div
            data-testid="agent-result"
            style={{
              fontFamily: T.font.mono,
              fontSize: 11,
              color: T.mutedMid,
              background: "rgba(0,0,0,0.25)",
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              padding: 12,
              whiteSpace: "pre-wrap",
              maxHeight: 240,
              overflow: "auto",
            }}
          >
            {JSON.stringify(result, null, 2)}
          </div>
        )}
      </form>
    </div>
  );
}
