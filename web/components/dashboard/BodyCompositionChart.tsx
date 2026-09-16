"use client";

import { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { FEATURED, readExtraMetric } from "@/lib/inbody";
import type { HealthMetricsRow } from "./BodyCompositionPanel";

// A plottable body-comp series. `axis` groups by scale family so lines stay
// readable: kg-family (weight, muscle) on the left, index-family (%, level,
// degrees — all small numbers) on the right.
type Series = {
  id: string;
  label: string;
  unit: string;
  axis: "kg" | "idx";
  color: string;
  defaultOn: boolean;
  get: (r: HealthMetricsRow) => number | null;
};

const stripUnit = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "");

export default function BodyCompositionChart({ history }: { history: HealthMetricsRow[] }) {
  const { t, locale } = useI18n();

  const ordered = useMemo(
    () => [...history].sort((a, b) => +new Date(a.recorded_at) - +new Date(b.recorded_at)),
    [history],
  );

  // Muscle line: prefer skeletal muscle mass; fall back to fat-free mass when a
  // device didn't report SMM. Label reflects whichever the latest reading has.
  const smmAnywhere = ordered.some((r) => readExtraMetric(r.extra_metrics, FEATURED.smm.aliases));

  const series = useMemo<Series[]>(() => [
    {
      id: "weight", label: stripUnit(t("flc.v.weight_kg")), unit: "kg", axis: "kg",
      color: "#e4c08c", defaultOn: true, get: (r) => r.weight_kg,
    },
    {
      id: "muscle",
      label: smmAnywhere ? t("bodycomp.smm") : stripUnit(t("flc.v.fat_free_mass_kg")),
      unit: "kg", axis: "kg", color: "#b0d4a0", defaultOn: true,
      get: (r) => readExtraMetric(r.extra_metrics, FEATURED.smm.aliases)?.value ?? r.fat_free_mass_kg ?? null,
    },
    {
      id: "bodyfat", label: stripUnit(t("flc.v.body_fat_pct")), unit: "%", axis: "idx",
      color: "#e89878", defaultOn: true, get: (r) => r.body_fat_pct,
    },
    {
      id: "visceral", label: t("bodycomp.visceralFat"), unit: FEATURED.visceralFat.unit, axis: "idx",
      color: "#d98cae", defaultOn: false,
      get: (r) => readExtraMetric(r.extra_metrics, FEATURED.visceralFat.aliases)?.value ?? null,
    },
    {
      id: "phase", label: t("bodycomp.phaseAngle"), unit: FEATURED.phaseAngle.unit, axis: "idx",
      color: "#8fb8d9", defaultOn: false,
      get: (r) => readExtraMetric(r.extra_metrics, FEATURED.phaseAngle.aliases)?.value ?? null,
    },
  ], [t, smmAnywhere]);

  // Only offer series that actually have data across the history.
  const available = useMemo(
    () => series.filter((s) => ordered.some((r) => s.get(r) != null)),
    [series, ordered],
  );

  const [selected, setSelected] = useState<Set<string>>(() => {
    const on = available.filter((s) => s.defaultOn).map((s) => s.id);
    return new Set(on.length ? on : available.slice(0, 1).map((s) => s.id));
  });
  const shown = available.filter((s) => selected.has(s.id));

  const data = useMemo(
    () => ordered.map((r) => {
      const point: Record<string, unknown> = {
        date: new Date(r.recorded_at).toLocaleDateString(locale === "zh" ? "zh-HK" : "en-GB", { month: "short", day: "numeric" }),
      };
      for (const s of available) point[s.id] = s.get(r);
      return point;
    }),
    [ordered, available, locale],
  );

  if (ordered.length < 2 || available.length === 0) return null;

  const hasKg = shown.some((s) => s.axis === "kg");
  const hasIdx = shown.some((s) => s.axis === "idx");

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { if (next.size > 1) next.delete(id); } // keep at least one line
      else next.add(id);
      return next;
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Interactive legend: colored chips double as the metric selector */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {available.map((s) => {
          const on = selected.has(s.id);
          return (
            <button
              key={s.id}
              type="button"
              data-testid={`bc-series-${s.id}`}
              onClick={() => toggle(s.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 10, padding: "3px 9px", borderRadius: 99,
                border: `1px solid ${on ? s.color : T.border}`,
                background: on ? `${s.color}22` : "transparent",
                color: on ? T.text : T.muted, cursor: "pointer", fontWeight: 600,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 99, background: on ? s.color : T.border }} />
              {s.label}
            </button>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 6, right: hasIdx ? 4 : 12, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(244,237,226,0.06)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: T.muted }} axisLine={{ stroke: T.border }} tickLine={false} />
          {hasKg && <YAxis yAxisId="kg" tick={{ fontSize: 10, fill: T.muted }} axisLine={false} tickLine={false} width={34} domain={["auto", "auto"]} />}
          {hasIdx && <YAxis yAxisId="idx" orientation="right" tick={{ fontSize: 10, fill: T.muted }} axisLine={false} tickLine={false} width={30} domain={["auto", "auto"]} />}
          <Tooltip content={<ChartTooltip shown={shown} />} cursor={{ stroke: T.border }} />
          {shown.map((s) => (
            <Line
              key={s.id}
              yAxisId={s.axis}
              type="monotone"
              dataKey={s.id}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={{ r: 2.5, fill: s.color }}
              activeDot={{ r: 4 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartTooltip({ active, payload, label, shown }: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number }>;
  label?: string;
  shown: Series[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 12px" }}>
      <div style={{ fontSize: 10, color: T.muted, marginBottom: 4, letterSpacing: "0.06em" }}>{label}</div>
      {payload.map((p) => {
        const s = shown.find((x) => x.id === p.dataKey);
        if (!s || p.value == null) return null;
        return (
          <div key={p.dataKey} style={{ fontSize: 12, color: s.color, fontWeight: 600 }}>
            {s.label}: {p.value}{s.unit && ` ${s.unit}`}
          </div>
        );
      })}
    </div>
  );
}
