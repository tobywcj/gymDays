"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";
import MarkdownSummary from "@/components/dashboard/MarkdownSummary";
import Spinner from "@/components/dashboard/Spinner";
import ThoughtLine from "@/components/dashboard/ThoughtLine";
import LiveSources from "@/components/dashboard/LiveSources";
import { useI18n } from "@/lib/i18n-context";
import { useAgentStream } from "@/lib/useAgentStream";
import { plainThought } from "@/components/dashboard/ThoughtLine";
import TimeframeSelect, { timeframeRange, type TimeframeKey } from "@/components/TimeframeSelect";

// Client-facing progress review. Mirrors the trainer's ProgressPanel timeframe
// control (a preset-window dropdown) so the client can re-run their own review
// over any window — but without the model picker (clients use the default LLM).
// Streams the agent's thoughts + live sources one line at a time, then the report.

function isToday(dateStr: string | null | undefined) {
  return !!dateStr && new Date(dateStr).toDateString() === new Date().toDateString();
}

type Report = {
  id: string;
  period_start: string;
  period_end: string;
  summary: string | null;
  created_at?: string | null;
};

export default function PortalProgressCard({ clientId, report }: { clientId: string; report: Report | null }) {
  const router = useRouter();
  const stream = useAgentStream();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<TimeframeKey>("1m");
  const busy = stream.running;

  async function run() {
    setError(null);
    const { days, periodStart, periodEnd } = timeframeRange(timeframe);
    try {
      await stream.start(`/api/ai/progress/${clientId}/stream`, {
        days, period_start: periodStart, period_end: periodEnd,
      });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="glass" style={{ borderRadius: T.radius.card, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", flexShrink: 0 }}>
        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em" }}>📊 {t("portal.latestReport")}</div>
          {report && (
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
              {t("progress.lastReviewed")} {report.period_start} → {report.period_end}
              {isToday(report.created_at) && (
                <span style={{ marginLeft: 8, color: "#4ade80" }}>{t("progress.updatedToday")}</span>
              )}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          <TimeframeSelect value={timeframe} onChange={setTimeframe} disabled={busy} />
          <button
            onClick={run}
            disabled={busy}
            style={{
              fontSize: 12, padding: "7px 14px", borderRadius: 99,
              background: "linear-gradient(135deg, rgba(122,148,124,0.95) 0%, rgba(80,108,88,0.95) 100%)",
              border: "1px solid rgba(255,252,245,0.25)", color: "#fffdf6", fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? <Spinner emoji="📊" label={plainThought(stream.thoughts[stream.thoughts.length - 1]) ?? t("common.analysing")} />
              : isToday(report?.created_at) ? t("progress.rerunToday")
              : report ? t("progress.rerunReview")
              : t("progress.runReview")}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {busy && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {stream.thoughts.length > 0 && (
            <div style={{
              display: "flex", flexDirection: "column", gap: 4,
              padding: "8px 12px", background: "rgba(0,0,0,0.18)",
              borderRadius: 8, borderLeft: `2px solid ${T.border}`,
              maxHeight: 160, overflowY: "auto",
            }}>
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
          <LiveSources sources={stream.sources} />
        </div>
      )}

      {error && (
        <div style={{ fontSize: 11, color: "#f87171", fontFamily: T.font.mono }}>{error}</div>
      )}

      {!busy && (
        report?.summary
          ? <MarkdownSummary text={report.summary} />
          : <div style={{ fontSize: 12, color: T.muted }}>{t("portal.noReport")}</div>
      )}
      </div>
    </section>
  );
}
