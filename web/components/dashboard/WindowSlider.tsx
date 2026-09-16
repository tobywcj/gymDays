"use client";

import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";

// Trainer-facing control for how far back the agent reads (activities, workout
// logs, session logs) when generating a program or nutrition advice. The value
// is sent as `window_days` and bounds the flow's data lookback server-side.
export default function WindowSlider({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <label
      data-testid="window-slider"
      title={t("panel.windowHint")}
      style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: T.muted, opacity: disabled ? 0.6 : 1 }}
    >
      <span style={{ whiteSpace: "nowrap" }}>{t("panel.window")}</span>
      <input
        type="range"
        min={7}
        max={90}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ accentColor: "#c49452", width: 96, cursor: disabled ? "not-allowed" : "pointer" }}
      />
      <span style={{ color: T.mutedMid, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", minWidth: 34 }}>
        {t("panel.windowDays").replace("{n}", String(value))}
      </span>
    </label>
  );
}
