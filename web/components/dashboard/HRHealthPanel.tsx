"use client";

import { useState } from "react";
import { T } from "@/lib/design-tokens";
import Spinner from "./Spinner";
import ThoughtLine, { plainThought } from "./ThoughtLine";
import LiveSources from "./LiveSources";
import MarkdownSummary from "./MarkdownSummary";
import PoweredByStrava from "@/components/strava/PoweredByStrava";
import { useI18n } from "@/lib/i18n-context";
import { useAgentStream } from "@/lib/useAgentStream";
import PaidRetry from "./PaidRetry";
import TimeframeSelect, { timeframeRange, type TimeframeKey } from "@/components/TimeframeSelect";

const ZONE_COLORS = ["#6ab0f5", "#86a378", "#e4c08c", "#f4a260", "#f47a7a"] as const;
const ZONE_KEYS   = ["z1", "z2", "z3", "z4", "z5"] as const;

const FLAG_COLORS: Record<string, string> = {
  aerobic_base_low:  "#f4a260",
  zone5_excess:      "#f47a7a",
  inconsistent_load: "#fbbf24",
  zone2_improving:   "#86a378",
  good_balance:      "#6ab0f5",
};

type WeekBucket = {
  week: string;
  sessions: number;
  total_s: number;
  z1: number; z2: number; z3: number; z4: number; z5: number;
  avg_hr?: number | null;
  max_hr?: number | null;
  avg_watts?: number | null;
  avg_speed?: number | null;
  elev_m?: number | null;
  suffer?: number | null;
  distance_m?: number | null;
};

type Props = {
  clientId: string;
  llms: { default: string; models: Record<string, string> } | null;
};

export default function HRHealthPanel({ clientId }: Props) {
  const stream = useAgentStream();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    weeks_data: WeekBucket[];
    insights: string | null;
    flags: string[];
    period_start?: string | null;
    period_end?:   string | null;
  } | null>(null);
  const [timeframe, setTimeframe] = useState<TimeframeKey>("3m");
  const busy = stream.running;
  const latestThought = stream.thoughts[stream.thoughts.length - 1];

  async function analyse() {
    setError(null);
    setResult(null);
    try {
      const { periodStart, periodEnd } = timeframeRange(timeframe);
      const payload = await stream.start(`/api/ai/hr-health/${clientId}/stream`, {
        period_start: periodStart,
        period_end:   periodEnd,
      });
      if (payload) {
        setResult(payload as unknown as {
          weeks_data: WeekBucket[];
          insights: string | null;
          flags: string[];
          period_start?: string | null;
          period_end?:   string | null;
        });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const hasZoneData = result?.weeks_data.some(
    (w) => w.z1 + w.z2 + w.z3 + w.z4 + w.z5 > 0
  );

  return (
    <div className="glass" style={{ borderRadius: T.radius.card, padding: "22px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t("hr.title")}</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
            {/* Pinned to the analysed result on screen (like Progress Review): the
                header shows the window the chart/insights below actually cover, so
                changing the dropdown without re-analysing never makes them disagree.
                Before the first analysis there's no body yet, so we preview the
                selected window as a hint. */}
            {result?.period_start && result?.period_end
              ? <>{t("hr.analysingRange")} {result.period_start} → {result.period_end}</>
              : <>{t("hr.analysingRange")} {timeframeRange(timeframe).periodStart} → {timeframeRange(timeframe).periodEnd}</>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <TimeframeSelect value={timeframe} onChange={setTimeframe} disabled={busy} />
          <button
            onClick={analyse}
            disabled={busy}
            style={{
              fontSize: 12, padding: "6px 14px", borderRadius: 99,
              background: busy ? "transparent" : "rgba(106,176,245,0.15)",
              border: `1px solid ${busy ? T.border : "rgba(106,176,245,0.4)"}`,
              color: busy ? T.muted : "#6ab0f5",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? <Spinner emoji="💙" label={plainThought(latestThought) ?? t("common.analysing")} /> : result ? t("hr.reanalyse") : t("hr.analyseZones")}
          </button>
        </div>
      </div>

      {busy && <LiveSources sources={stream.sources} />}

      {busy && stream.thoughts.length > 0 && (
        <div
          data-testid="hr-health-thoughts"
          style={{
            display: "flex", flexDirection: "column", gap: 4,
            padding: "8px 12px", background: "rgba(0,0,0,0.18)",
            borderRadius: 8, borderLeft: `2px solid ${T.border}`,
            maxHeight: 140, overflowY: "auto", marginBottom: 12,
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
        <div style={{ fontSize: 11, color: "#f87171", marginBottom: 12 }}>{error}</div>
      )}

      {!busy && result && (
        <>
          {/* ── Zone stacked bar chart ── */}
          {hasZoneData ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 4, marginBottom: 6, alignItems: "flex-end", height: 60 }}>
                {result.weeks_data.map((w) => {
                  const total = w.z1 + w.z2 + w.z3 + w.z4 + w.z5;
                  return (
                    <div key={w.week} style={{ flex: 1, display: "flex", flexDirection: "column-reverse", gap: 1, height: "100%" }} title={w.week}>
                      {total === 0 ? (
                        <div style={{ flex: 1, background: "rgba(255,255,255,0.05)", borderRadius: 2 }} />
                      ) : (
                        ZONE_KEYS.map((k, i) => {
                          const pct = w[k] / total;
                          return pct > 0 ? (
                            <div key={k} style={{
                              flex: w[k], background: ZONE_COLORS[i],
                              borderRadius: i === 4 ? "2px 2px 0 0" : 0,
                              minHeight: 2,
                            }} />
                          ) : null;
                        })
                      )}
                    </div>
                  );
                })}
              </div>
              {/* week labels */}
              <div style={{ display: "flex", gap: 4 }}>
                {result.weeks_data.map((w) => (
                  <div key={w.week} style={{ flex: 1, fontSize: 8, color: T.muted, textAlign: "center", overflow: "hidden" }}>
                    {w.week}
                  </div>
                ))}
              </div>
              {/* zone legend */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
                {ZONE_KEYS.map((zk, i) => (
                  <div key={zk} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: T.mutedMid }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: ZONE_COLORS[i], display: "inline-block" }} />
                    {t(`zone.${zk}`)}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 12 }}>
              {t("hr.noZoneData")}
            </div>
          )}

          {/* ── Flags ── */}
          {result.flags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {result.flags.map((f) => {
                const color = FLAG_COLORS[f] ?? T.muted;
                const label = FLAG_COLORS[f] ? t(`hrflag.${f}`) : f;
                return (
                  <span key={f} style={{
                    fontSize: 10, fontWeight: 600, padding: "3px 9px", borderRadius: 99,
                    background: `${color}18`, border: `1px solid ${color}55`,
                    color,
                  }}>
                    {label}
                  </span>
                );
              })}
            </div>
          )}

          {/* ── Insights ── */}
          {result.insights && (
            <div style={{
              borderTop: `1px solid ${T.border}`, paddingTop: 12,
            }}>
              <MarkdownSummary text={result.insights} />
            </div>
          )}

          {!result.insights && !hasZoneData && null}
        </>
      )}
      <PoweredByStrava height={12} align="right" />
    </div>
  );
}
