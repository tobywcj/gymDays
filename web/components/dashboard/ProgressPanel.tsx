"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";
import MarkdownSummary from "./MarkdownSummary";
import Spinner from "./Spinner";
import ThoughtLine, { plainThought } from "./ThoughtLine";
import LiveSources from "./LiveSources";
import { useI18n } from "@/lib/i18n-context";
import { useAgentStream } from "@/lib/useAgentStream";
import PaidRetry from "./PaidRetry";
import TimeframeSelect, { timeframeRange, timeframeForDays, type TimeframeKey } from "@/components/TimeframeSelect";


type Flag = { kind: string; severity: "low" | "medium" | "high"; rationale: string; raised_at: string };
type Report = {
  id: string;
  period_start: string;
  period_end: string;
  summary: string | null;
  flags: Flag[] | null;
  created_at: string;
};

type Props = {
  clientId: string;
  report: Report | null;
  llms: { default: string; models: Record<string, string>; keys: { openai: boolean; anthropic: boolean } } | null;
  autoRun?: boolean;
};

const SEV_COLOR: Record<Flag["severity"], string> = {
  low:    "#fbbf24",
  medium: "#f97316",
  high:   "#ef4444",
};

function isToday(dateStr: string) {
  return new Date(dateStr).toDateString() === new Date().toDateString();
}

export default function ProgressPanel({ clientId, report, llms, autoRun }: Props) {
  const router = useRouter();
  const stream = useAgentStream();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  // Start the dropdown on the window the existing report actually covers, so the
  // "Last reviewed X → Y" label and the filter agree on load (falls back to 1m).
  const [timeframe, setTimeframe] = useState<TimeframeKey>(() =>
    report
      ? timeframeForDays(Math.round((Date.parse(report.period_end) - Date.parse(report.period_start)) / 86_400_000))
      : "1m",
  );
  const busy = stream.running;
  const latestThought = stream.thoughts[stream.thoughts.length - 1];

  useEffect(() => {
    if (autoRun && llms && (!report || !isToday(report.created_at))) {
      run();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const flags = report?.flags ?? [];

  return (
    <div className="glass" style={{ borderRadius: T.radius.card, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t("progress.title")}</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
            {report
              ? <>
                  {t("progress.lastReviewed")} {report.period_start} → {report.period_end}
                  {isToday(report.created_at) && (
                    <span style={{ marginLeft: 8, color: "#4ade80" }}>{t("progress.updatedToday")}</span>
                  )}
                </>
              : t("progress.auto")}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          <TimeframeSelect value={timeframe} onChange={setTimeframe} disabled={busy} />
          <button
            onClick={run}
            disabled={busy || !llms}
            data-testid="run-progress"
            style={{
              fontSize: 12,
              padding: "7px 14px",
              borderRadius: 99,
              background: "linear-gradient(135deg, rgba(122,148,124,0.95) 0%, rgba(80,108,88,0.95) 100%)",
              border: "1px solid rgba(255,252,245,0.25)",
              color: "#fffdf6",
              fontWeight: 600,
              cursor: busy || !llms ? "not-allowed" : "pointer",
              opacity: busy || !llms ? 0.7 : 1,
            }}
          >
            {busy ? <Spinner emoji="📊" label={plainThought(latestThought) ?? t("common.analysing")} /> : report && isToday(report.created_at) ? t("progress.rerunToday") : report ? t("progress.rerunReview") : t("progress.runReview")}
          </button>
        </div>
      </div>

      {busy && <LiveSources sources={stream.sources} />}

      {busy && stream.thoughts.length > 0 && (
        <div
          data-testid="progress-thoughts"
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

      {!llms && (
        <div data-testid="progress-service-down" style={{ fontSize: 12, color: T.muted }}>
          {t("panel.serviceDown")}{" "}
          <code style={{ fontFamily: T.font.mono, color: T.accent }}>uvicorn ai.main:app --port 8001</code>.
        </div>
      )}

      <PaidRetry stream={stream} />

      {error && (
        <div data-testid="progress-error" style={{ fontSize: 11, color: "#f87171", fontFamily: T.font.mono }}>
          {error}
        </div>
      )}

      {!busy && report?.summary && (
        <div style={{ background: "rgba(0,0,0,0.18)", padding: "12px 16px", borderRadius: 10 }}>
          <MarkdownSummary text={report.summary} />
        </div>
      )}

      {!busy && flags.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.muted }}>
            {t("progress.flags")} ({flags.length})
          </div>
          {flags.map((f, i) => (
            <div
              key={i}
              data-testid="progress-flag"
              style={{
                background: "rgba(0,0,0,0.18)",
                borderRadius: 10,
                borderLeft: `3px solid ${SEV_COLOR[f.severity]}`,
                padding: "10px 12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                  background: SEV_COLOR[f.severity] + "33", color: SEV_COLOR[f.severity],
                  padding: "2px 8px", borderRadius: 99,
                }}>
                  {f.kind} · {t(`sev.${f.severity}`)}
                </span>
              </div>
              <MarkdownSummary text={f.rationale} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
