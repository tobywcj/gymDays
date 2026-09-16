"use client";

import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { AFT_BY_KEY, type AftLevel } from "@/lib/exercise-library";
import { useAgentStream } from "@/lib/useAgentStream";
import AftBadge from "./AftBadge";
import Spinner from "@/components/dashboard/Spinner";
import { plainThought } from "@/components/dashboard/ThoughtLine";

export type AftState = {
  aft_level: AftLevel | null;
  aft_rationale: string | null;
  aft_signals: { label: string; value: string }[] | null;
  aft_classified_at: string | null;
};

type Props = {
  clientId: string | null;
  clientName: string | null;
  aft: AftState | null;
  onClassified: (next: AftState) => void;
  readOnly?: boolean;
};

// The Progress agent's AFT classification card. On Refresh it streams the agent's
// live thought process, then shows the concise result (level + rationale +
// the signals it weighed). Classification only runs on click (spends tokens).
export default function AftLevelCard({ clientId, clientName, aft, onClassified, readOnly }: Props) {
  const { t, locale } = useI18n();
  const stream = useAgentStream();

  const current = aft?.aft_level ?? null;
  const lvl = current ? AFT_BY_KEY[current] : null;
  const running = stream.running;

  async function classify() {
    if (!clientId || running) return;
    const result = await stream.start(`/api/client/${clientId}/aft/stream`, {}).catch(() => null);
    if (result) {
      onClassified({
        aft_level: (result.level as AftLevel) ?? null,
        aft_rationale: (result.rationale as string) ?? null,
        aft_signals: (result.signals as { label: string; value: string }[]) ?? null,
        aft_classified_at: (result.classified_at as string) ?? null,
      });
    }
  }

  const classifiedAt = aft?.aft_classified_at
    ? new Date(aft.aft_classified_at).toLocaleDateString(locale === "zh" ? "zh-HK" : "en-GB", { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <div className="glass" style={{ borderRadius: T.radius.card, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>🧭 {t("aft.title")}</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>{t("aft.subtitle")}</div>
        </div>

        {clientId ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {current ? (
              <AftBadge level={current} name={clientName} />
            ) : (
              !running && <span style={{ fontSize: 11, color: T.muted }}>{t("aft.notClassified")}</span>
            )}
            {!readOnly && (
              <button
                onClick={classify}
                disabled={running}
                data-testid="aft-refresh"
                style={{
                  fontSize: 11, fontWeight: 600, padding: "6px 12px", borderRadius: 8, cursor: running ? "default" : "pointer",
                  border: `1px solid ${T.border}`, background: "rgba(196,148,82,0.16)", color: "#e4c08c",
                  display: "inline-flex", alignItems: "center", gap: 6, opacity: running ? 0.7 : 1,
                }}
              >
                {running ? <Spinner emoji="🧠" label={plainThought(stream.thoughts[stream.thoughts.length - 1]) ?? t("aft.classifying")} /> : <>↻ {t("aft.refresh")}</>}
              </button>
            )}
          </div>
        ) : (
          <span style={{ fontSize: 11, color: T.muted, flexShrink: 0 }}>{t("aft.pickClient")}</span>
        )}
      </div>

      {stream.error && <div style={{ fontSize: 11, color: "#f0a4a4" }}>{t("aft.error")}</div>}

      {/* Live thought process while the agent runs */}
      {running && stream.thoughts.length > 0 && (
        <div
          data-testid="aft-thoughts"
          style={{
            display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px", borderRadius: 10,
            background: "rgba(0,0,0,0.28)", border: `1px solid ${T.border}`, maxHeight: 168, overflowY: "auto",
          }}
        >
          {stream.thoughts.map((line, i) => (
            <div
              key={i}
              style={{ fontSize: 11, color: T.mutedMid, lineHeight: 1.5, opacity: i === stream.thoughts.length - 1 ? 1 : 0.6 }}
            >
              {line}
            </div>
          ))}
        </div>
      )}

      {/* Concise result — rationale + the signals the agent weighed */}
      {!running && clientId && lvl && aft?.aft_rationale && (
        <div style={{ borderLeft: `3px solid ${lvl.color}`, paddingLeft: 12, display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: lvl.color, textTransform: "uppercase", letterSpacing: "0.04em" }}>{locale === "zh" ? lvl.who.zh : lvl.who.en}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {aft.aft_rationale.split("\n").map((line, i) => {
              const text = line.replace(/^•\s*/, "").trim();
              if (!text) return null;
              return (
                <div key={i} style={{ display: "flex", gap: 7, fontSize: 12, color: T.text, lineHeight: 1.5 }}>
                  <span style={{ color: lvl.color, flexShrink: 0 }}>•</span>
                  <span>{text}</span>
                </div>
              );
            })}
          </div>
          {aft.aft_signals && aft.aft_signals.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
              {aft.aft_signals.map((s, i) => (
                <span key={i} style={{ fontSize: 10, color: T.mutedMid, border: `1px solid ${T.border}`, borderRadius: 6, padding: "2px 7px" }}>
                  <b style={{ color: T.text }}>{s.label}:</b> {s.value}
                </span>
              ))}
            </div>
          )}
          {classifiedAt && <div style={{ fontSize: 10, color: T.muted }}>{t("aft.classifiedAt")} {classifiedAt}</div>}
        </div>
      )}
    </div>
  );
}
