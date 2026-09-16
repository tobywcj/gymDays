"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { chartData } from "@/lib/mock";

type TooltipPayload = {
  active?: boolean;
  payload?: Array<{ name: string; dataKey: string; value: number; color: string }>;
  label?: string;
};

function ChartTooltip({ active, payload, label }: TooltipPayload) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "#1a1a1a",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        padding: "10px 14px",
      }}
    >
      <div style={{ fontSize: 11, color: T.muted, marginBottom: 6, letterSpacing: "0.08em" }}>{label}</div>
      {payload.map((p) => {
        const unit = p.dataKey === "weight" ? " kg" : p.dataKey === "hrv" ? " ms" : " kg";
        return (
          <div key={p.dataKey} style={{ fontSize: 12, color: p.color, marginBottom: 2 }}>
            {p.name}: <strong>{p.value}{unit}</strong>
          </div>
        );
      })}
    </div>
  );
}

export default function ClientProgressChart() {
  const { t } = useI18n();
  const legend = [
    { label: t("chart.weight"), color: "#e4c08c" },
    { label: t("chart.hrv"),    color: "#bcd3b8" },
    { label: t("chart.volume"), color: "#d3a78a" },
  ];
  return (
    <div className="glass" style={{ borderRadius: T.radius.card, padding: "22px 24px", position: "relative" }}>
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.01em" }}>{t("chart.title")}</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{t("chart.subtitle")}</div>
        </div>
        <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
          {legend.map((l) => (
            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: T.mutedMid }}>
              <span style={{ width: 20, height: 2, background: l.color, borderRadius: 2, display: "inline-block" }} />
              {l.label}
            </div>
          ))}
        </div>
      </div>
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="week"
              tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10, fontFamily: T.font.sans }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis yAxisId="left" hide domain={["dataMin - 2", "dataMax + 2"]} />
            <YAxis yAxisId="hrv" hide domain={["dataMin - 5", "dataMax + 5"]} />
            <YAxis yAxisId="vol" hide domain={["dataMin - 1000", "dataMax + 1000"]} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(244,237,226,0.10)", strokeWidth: 1 }} />
            <Line yAxisId="left" dataKey="weight" name={t("chart.weight")} stroke="#e4c08c" strokeWidth={2.2} dot={false} activeDot={{ r: 4, fill: "#e4c08c", strokeWidth: 0 }} />
            <Line yAxisId="hrv"  dataKey="hrv"    name={t("chart.hrv")}    stroke="#bcd3b8" strokeWidth={2.2} dot={false} activeDot={{ r: 4, fill: "#bcd3b8", strokeWidth: 0 }} />
            <Line yAxisId="vol"  dataKey="volume" name={t("chart.volume")} stroke="#d3a78a" strokeWidth={2.2} dot={false} activeDot={{ r: 4, fill: "#d3a78a", strokeWidth: 0 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
