"use client";

import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";

// Shared timeframe filter used everywhere a review/analysis window is chosen
// (trainer + client). Replaces the old from/to date pickers with a single
// dropdown of preset windows. `timeframeRange()` turns the chosen key into the
// { days, periodStart, periodEnd } shape every AI flow already expects.

export type TimeframeKey = "2w" | "1m" | "3m" | "6m" | "1y" | "2y" | "3y" | "all";

export const TIMEFRAME_KEYS: TimeframeKey[] = ["2w", "1m", "3m", "6m", "1y", "2y", "3y", "all"];

const DAYS: Record<TimeframeKey, number> = {
  "2w": 14, "1m": 30, "3m": 90, "6m": 180,
  "1y": 365, "2y": 730, "3y": 1095,
  // "all" anchors to a far-past start so the whole history is covered.
  "all": 0,
};

const ALL_START = "2000-01-01";

function toDateInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Reverse of timeframeRange: pick the preset whose window best matches a span
 * (in days). Used to make a dropdown reflect the period an existing report
 * actually covers, so the two stay in sync on load. */
export function timeframeForDays(days: number): TimeframeKey {
  let best: TimeframeKey = "1m";
  let bestDiff = Infinity;
  for (const k of TIMEFRAME_KEYS) {
    if (k === "all") continue;
    const diff = Math.abs(DAYS[k] - days);
    if (diff < bestDiff) { bestDiff = diff; best = k; }
  }
  return best;
}

/** Resolve a timeframe key to the date window + day count the AI flows expect. */
export function timeframeRange(key: TimeframeKey): { days: number; periodStart: string; periodEnd: string } {
  const today = new Date();
  const periodEnd = toDateInput(today);
  if (key === "all") {
    const days = Math.max(1, Math.round((today.getTime() - new Date(ALL_START).getTime()) / 86_400_000));
    return { days, periodStart: ALL_START, periodEnd };
  }
  const days = DAYS[key];
  const periodStart = toDateInput(new Date(today.getTime() - days * 86_400_000));
  return { days, periodStart, periodEnd };
}

export default function TimeframeSelect({
  value,
  onChange,
  disabled,
}: {
  value: TimeframeKey;
  onChange: (k: TimeframeKey) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as TimeframeKey)}
      disabled={disabled}
      data-testid="timeframe-select"
      style={{
        background: "rgba(0,0,0,0.45)", border: `1px solid ${T.border}`,
        borderRadius: 8, padding: "6px 8px", color: T.text,
        fontSize: 11, outline: "none", colorScheme: "dark",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {TIMEFRAME_KEYS.map((k) => (
        <option key={k} value={k}>{t(`timeframe.${k}`)}</option>
      ))}
    </select>
  );
}
