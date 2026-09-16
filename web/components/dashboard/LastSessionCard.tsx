"use client";

import { useState } from "react";
import { T } from "@/lib/design-tokens";
import Spinner from "./Spinner";
import ThoughtLine, { plainThought } from "./ThoughtLine";
import LiveSources from "./LiveSources";
import MarkdownSummary from "./MarkdownSummary";
import { useI18n } from "@/lib/i18n-context";
import { useAgentStream } from "@/lib/useAgentStream";
import PaidRetry from "./PaidRetry";

type Source = { title: string; url?: string | null };
type Result = {
  headline?: string;
  analysis?: string;
  intensity?: "easy" | "moderate" | "hard" | "unknown";
  next_focus?: string;
  last_session_at?: string;
  sources?: Source[];
};

type Props = {
  clientId: string;
  llms: { default: string; models: Record<string, string>; keys: { openai: boolean; anthropic: boolean } } | null;
};

const INTENSITY_TINT: Record<string, { bg: string; fg: string }> = {
  easy:     { bg: "rgba(140,164,140,0.18)", fg: "#a7c39c" },
  moderate: { bg: "rgba(196,148,82,0.18)",  fg: "#e4c08c" },
  hard:     { bg: "rgba(196,108,76,0.20)",  fg: "#e89a7c" },
  unknown:  { bg: "rgba(244,237,226,0.08)", fg: T.muted },
};

export default function LastSessionCard({ clientId, llms }: Props) {
  const stream = useAgentStream();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const busy = stream.running;
  const latestThought = stream.thoughts[stream.thoughts.length - 1];

  async function analyse() {
    setError(null);
    setResult(null);
    try {
      const payload = await stream.start(
        `/api/ai/session-analysis/${clientId}/stream`,
        {},
      );
      if (payload) setResult(payload as Result);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const intensity = result?.intensity ?? "unknown";
  const tint = INTENSITY_TINT[intensity] ?? INTENSITY_TINT.unknown;

  return (
    <div className="glass" style={{ borderRadius: T.radius.card, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 180px" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t("sessionA.title")}</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{t("sessionA.subtitle")}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          <button
            onClick={analyse}
            disabled={busy || !llms}
            data-testid="run-session-analysis"
            style={{
              fontSize: 12, padding: "7px 14px", borderRadius: 99,
              background: "linear-gradient(135deg, rgba(122,148,140,0.95) 0%, rgba(72,98,90,0.95) 100%)",
              border: "1px solid rgba(255,252,245,0.25)", color: "#fffdf6", fontWeight: 600,
              cursor: busy || !llms ? "not-allowed" : "pointer", opacity: busy || !llms ? 0.7 : 1,
              boxShadow: "0 1px 0 rgba(255,252,245,0.45) inset, 0 6px 20px rgba(72,98,90,0.45)",
            }}
          >
            {busy ? <Spinner emoji="🔍" label={plainThought(latestThought) ?? t("common.generating")} /> : result ? t("sessionA.reanalyse") : t("sessionA.analyse")}
          </button>
        </div>
      </div>

      {busy && <LiveSources sources={stream.sources} />}

      {busy && stream.thoughts.length > 0 && (
        <div
          data-testid="session-thoughts"
          style={{
            display: "flex", flexDirection: "column", gap: 4, padding: "8px 12px",
            background: "rgba(0,0,0,0.18)", borderRadius: 8, borderLeft: `2px solid ${T.border}`,
            maxHeight: 140, overflowY: "auto",
          }}
        >
          {stream.thoughts.map((line, i) => (
            <div key={i} style={{
              fontSize: 11, color: T.muted, lineHeight: 1.45, fontFamily: T.font.mono,
              opacity: i === stream.thoughts.length - 1 ? 1 : 0.55,
            }}>
              <ThoughtLine line={line} />
            </div>
          ))}
        </div>
      )}

      {!llms && (
        <div data-testid="session-service-down" style={{ fontSize: 12, color: T.muted }}>
          {t("panel.serviceDown")}{" "}
          <code style={{ fontFamily: T.font.mono, color: T.accent }}>uvicorn ai.main:app --port 8001</code>.
        </div>
      )}

      <PaidRetry stream={stream} />

      {error && (
        <div data-testid="session-error" style={{ fontSize: 11, color: "#f87171", fontFamily: T.font.mono }}>
          {error}
        </div>
      )}

      {!busy && !result && !error && (
        <div style={{ fontSize: 12, color: T.muted }}>{t("sessionA.empty")}</div>
      )}

      {!busy && result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(result.headline || intensity !== "unknown") && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                padding: "3px 9px", borderRadius: 99, background: tint.bg, color: tint.fg,
              }}>
                {t(`sessionA.intensity.${intensity}`)}
              </span>
              {result.headline && (
                <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{result.headline}</span>
              )}
            </div>
          )}

          {result.analysis && (
            <div style={{ background: "rgba(0,0,0,0.18)", borderRadius: 10, padding: "12px 14px", borderLeft: `3px solid ${T.accentBlue}` }}>
              <MarkdownSummary text={result.analysis} />
            </div>
          )}

          {result.next_focus && (
            <div style={{
              fontSize: 12, color: T.mutedMid, display: "flex", gap: 8, alignItems: "baseline",
              padding: "10px 14px", borderRadius: 10, background: "rgba(196,148,82,0.10)",
              border: "1px solid rgba(196,148,82,0.2)",
            }}>
              <span style={{ color: "#e4c08c", fontWeight: 700, flexShrink: 0 }}>🎯 {t("sessionA.nextFocus")}</span>
              <span>{result.next_focus}</span>
            </div>
          )}

          {(result.sources?.length ?? 0) > 0 && (
            <div data-testid="session-sources">
              <div style={{
                fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
                color: "#e4c08c", marginBottom: 5, borderBottom: "1px solid rgba(196,148,82,0.2)", paddingBottom: 4,
              }}>
                {t("program.sources")}
              </div>
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                {result.sources!.map((s, i) => (
                  <li key={i} style={{ display: "flex", gap: 8, fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
                    <span style={{ color: "#e4c08c", flexShrink: 0 }}>·</span>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: T.accent, textDecoration: "underline" }}>
                        {s.title || s.url}
                      </a>
                    ) : <span>{s.title}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
