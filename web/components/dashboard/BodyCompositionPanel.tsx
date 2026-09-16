"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { TYPED_METRICS, FEATURED, readExtraMetric } from "@/lib/inbody";
import LogInBody from "./LogInBody";
import BodyCompositionChart from "./BodyCompositionChart";

// One InBody / BIA reading for a client — the typed columns plus the
// machine-specific `extra_metrics` bag captured at intake or a later log.
export type HealthMetricsRow = {
  id: string;
  recorded_at: string;
  source: string | null;
  weight_kg: number | null;
  bmi: number | null;
  body_fat_pct: number | null;
  fat_free_mass_kg: number | null;
  bmr_kcal: number | null;
  waist_hip_ratio: number | null;
  total_body_water_pct: number | null;
  extra_metrics: Record<string, unknown> | null;
};

type Reading = { label: string; value: number | string; unit: string };

function stripUnit(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "");
}

function parseExtra(raw: Record<string, unknown> | null): { machine: string | null; rows: Reading[] } {
  if (!raw || typeof raw !== "object") return { machine: null, rows: [] };
  const machine = typeof raw._machine === "string" ? raw._machine : null;
  const rows: Reading[] = [];
  for (const [key, v] of Object.entries(raw)) {
    if (key.startsWith("_") || v == null || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (o.value == null) continue;
    rows.push({
      label: typeof o.label === "string" && o.label ? o.label : key.replace(/_/g, " "),
      value: o.value as number | string,
      unit: typeof o.unit === "string" ? o.unit : "",
    });
  }
  return { machine, rows };
}

// The headline tiles for the latest reading — mirrors InBody's own framing.
function buildMainTiles(row: HealthMetricsRow, t: (k: string) => string): Reading[] {
  const stripKey = (k: string) => stripUnit(t(TYPED_METRICS.find((m) => m.key === k)!.i18nKey));
  const tiles: Reading[] = [];
  if (typeof row.weight_kg === "number") tiles.push({ label: stripKey("weight_kg"), value: row.weight_kg, unit: "kg" });
  if (typeof row.body_fat_pct === "number") tiles.push({ label: stripKey("body_fat_pct"), value: row.body_fat_pct, unit: "%" });

  // Muscle: skeletal muscle mass if the device reported it, else fat-free mass.
  const smm = readExtraMetric(row.extra_metrics, FEATURED.smm.aliases);
  if (smm) tiles.push({ label: t("bodycomp.smm"), value: smm.value, unit: smm.unit || "kg" });
  else if (typeof row.fat_free_mass_kg === "number") tiles.push({ label: stripKey("fat_free_mass_kg"), value: row.fat_free_mass_kg, unit: "kg" });

  const vf = readExtraMetric(row.extra_metrics, FEATURED.visceralFat.aliases);
  if (vf) tiles.push({ label: t("bodycomp.visceralFat"), value: vf.value, unit: vf.unit });
  const pa = readExtraMetric(row.extra_metrics, FEATURED.phaseAngle.aliases);
  if (pa) tiles.push({ label: t("bodycomp.phaseAngle"), value: pa.value, unit: pa.unit || "°" });

  return tiles;
}

// Every metric on a reading (all typed columns present + all machine extras).
function allMetrics(row: HealthMetricsRow, t: (k: string) => string): Reading[] {
  const out: Reading[] = [];
  for (const { key, i18nKey, unit } of TYPED_METRICS) {
    const v = row[key as keyof HealthMetricsRow];
    if (typeof v === "number") out.push({ label: stripUnit(t(i18nKey)), value: v, unit });
  }
  out.push(...parseExtra(row.extra_metrics).rows);
  return out;
}

export default function BodyCompositionPanel({ history, clientId }: { history: HealthMetricsRow[]; clientId: string }) {
  const { t, locale } = useI18n();
  const [logging, setLogging] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const row = history[0] ?? null; // history is newest-first; [0] is the latest reading
  const { machine } = parseExtra(row?.extra_metrics ?? null);
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "zh" ? "zh-HK" : "en-GB", { year: "numeric", month: "short", day: "numeric" });

  // Minimal view — the metrics that best frame a fitness journey (as InBody
  // itself does): Weight, Body Fat %, Muscle (skeletal muscle mass, falling
  // back to fat-free mass), Visceral Fat, Phase Angle. Only shown when present.
  const mainTiles = row ? buildMainTiles(row, t) : [];

  return (
    <div className="glass" style={{ borderRadius: T.radius.card, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15 }}>⚖️</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{t("bodycomp.title")}</span>
        </div>
        <div style={{ fontSize: 10, color: T.muted, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {machine && (
            <span style={{ padding: "2px 8px", borderRadius: 99, border: `1px solid ${T.border}`, color: T.mutedMid }}>{machine}</span>
          )}
          {row && <span>{t("bodycomp.recorded")} {fmtDate(row.recorded_at)}</span>}
          {!logging && (
            <button
              type="button"
              data-testid="log-inbody-btn"
              onClick={() => setLogging(true)}
              style={pillBtn}
            >
              {t("bodycomp.log")}
            </button>
          )}
        </div>
      </div>

      {logging && <LogInBody clientId={clientId} onDone={() => setLogging(false)} />}

      {!row && !logging && <div style={{ fontSize: 11, color: T.muted }}>{t("bodycomp.empty")}</div>}

      {/* Minimal: main metrics only */}
      {mainTiles.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8 }}>
          {mainTiles.map((m) => (
            <div key={m.label} style={tile}>
              <div style={tileLabel}>{m.label}</div>
              <div style={tileValue}>
                {fmt(m.value)}<span style={tileUnit}>{m.unit && ` ${m.unit}`}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* One minimal chart of the main metrics, with a legend */}
      {history.length >= 2 && <BodyCompositionChart history={history} />}

      {/* A single reading can't form a trend line — say so instead of a blank space. */}
      {history.length === 1 && mainTiles.length > 0 && (
        <div style={{ fontSize: 10, color: T.muted }}>{t("bodycomp.needMore")}</div>
      )}

      {/* Everything else is collapsed — full per-log breakdown behind a toggle */}
      {row && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            type="button"
            data-testid="bc-toggle-details"
            onClick={() => setShowAll((v) => !v)}
            style={{ ...pillBtn, alignSelf: "flex-start" }}
          >
            {showAll ? t("bodycomp.hideAll") : `${t("bodycomp.showAll")} · ${history.length}`}
          </button>
          {showAll && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {history.map((r, i) => (
                <LogDetails key={r.id} row={r} clientId={clientId} dateLabel={fmtDate(r.recorded_at)} defaultOpen={i === 0} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LogDetails({ row, clientId, dateLabel, defaultOpen }: { row: HealthMetricsRow; clientId: string; dateLabel: string; defaultOpen: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const metrics = allMetrics(row, t);
  const machine = parseExtra(row.extra_metrics).machine;
  const srcKey = row.source === "intake" ? "bodycomp.src.intake" : row.source === "self-report" ? "bodycomp.src.self" : "bodycomp.src.session";

  async function remove() {
    setDeleting(true);
    try {
      const r = await fetch(`/api/clients/${clientId}/health-metrics?metricId=${row.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
      router.refresh();
    } catch {
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <details open={defaultOpen} style={{ border: `1px solid ${T.border}`, borderRadius: 8, background: "rgba(0,0,0,0.12)" }}>
      <summary style={{ cursor: "pointer", listStyle: "none", padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
        <span style={{ color: T.text, fontWeight: 600 }}>{dateLabel}</span>
        <span style={{ padding: "1px 7px", borderRadius: 99, background: "rgba(98,132,88,0.16)", border: `1px solid ${T.border}`, color: T.mutedMid, fontSize: 9 }}>
          {t(srcKey)}
        </span>
        {machine && <span style={{ color: T.muted, fontSize: 9 }}>{machine}</span>}
        <span style={{ marginLeft: "auto", color: T.muted, fontSize: 9 }}>{metrics.length} {t("bodycomp.metrics")}</span>
        {confirming ? (
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); void remove(); }}
              disabled={deleting}
              style={{ ...delBtn, color: "#fab9a9", borderColor: "rgba(250,185,169,0.5)" }}
            >
              {deleting ? t("bodycomp.deleting") : t("bodycomp.confirmDelete")}
            </button>
            <button type="button" onClick={(e) => { e.preventDefault(); setConfirming(false); }} disabled={deleting} style={delBtn}>
              {t("bodycomp.cancel")}
            </button>
          </span>
        ) : (
          <button
            type="button"
            aria-label={t("bodycomp.delete")}
            data-testid="bc-delete-reading"
            onClick={(e) => { e.preventDefault(); setConfirming(true); }}
            style={delBtn}
          >
            {t("bodycomp.delete")}
          </button>
        )}
      </summary>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "3px 16px", padding: "2px 12px 10px" }}>
        {metrics.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, padding: "3px 0", borderBottom: `1px solid ${T.border}` }}>
            <span style={{ color: T.muted, textTransform: "capitalize" }}>{m.label}</span>
            <span style={{ color: T.text, fontWeight: 600, whiteSpace: "nowrap" }}>{fmt(m.value)}{m.unit && ` ${m.unit}`}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function fmt(v: number | string | null): string {
  if (v == null) return "—";
  return String(v);
}

const pillBtn: React.CSSProperties = {
  background: "transparent",
  border: `1px solid ${T.border}`,
  borderRadius: 99,
  padding: "4px 12px",
  color: T.mutedMid,
  fontSize: 10,
  cursor: "pointer",
  fontWeight: 600,
};
const delBtn: React.CSSProperties = {
  background: "transparent",
  border: `1px solid ${T.border}`,
  borderRadius: 99,
  padding: "2px 8px",
  color: T.muted,
  fontSize: 9,
  cursor: "pointer",
  fontWeight: 600,
};
const tile: React.CSSProperties = {
  background: "rgba(0,0,0,0.18)",
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  padding: "8px 10px",
  display: "flex",
  flexDirection: "column",
  gap: 3,
};
const tileLabel: React.CSSProperties = { fontSize: 9, color: T.muted, letterSpacing: "0.06em", textTransform: "uppercase" };
const tileValue: React.CSSProperties = { fontSize: 16, fontWeight: 700, color: T.text };
const tileUnit: React.CSSProperties = { fontSize: 10, fontWeight: 500, color: T.mutedMid };
