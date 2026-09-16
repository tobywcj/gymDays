// Shared InBody / BIA capture helpers, used by both the first-lesson intake
// wizard and the standalone "log a reading" form so the two never diverge.

// A machine-specific / manually-added body-comp reading (one editable row).
export type ExtraMetric = { key: string; label: string; value: string; unit: string };

// Shape returned by the /inbody-ocr endpoints.
export type InbodyOcr = {
  machine?: string | null;
  mapped?: Record<string, number | null>;
  extra?: Array<{ key: string; label?: string; value?: number | null; unit?: string }>;
};

// The 7 typed body-comp fields that map to columns on client_health_metrics.
export const INBODY_FIELDS: Array<[key: string, i18nKey: string, placeholder: string]> = [
  ["weight_kg", "flc.v.weight_kg", "72.5"],
  ["bmi", "flc.v.bmi", "22.1"],
  ["body_fat_pct", "flc.v.body_fat_pct", "18.4"],
  ["fat_free_mass_kg", "flc.v.fat_free_mass_kg", "59.2"],
  ["bmr_kcal", "flc.v.bmr_kcal", "1620"],
  ["waist_hip_ratio", "flc.v.waist_hip_ratio", "0.82"],
  ["total_body_water_pct", "flc.v.total_body_water_pct", "58.0"],
];

// Typed body-comp columns with their i18n label key + display unit. Shared by
// the latest-reading tiles and the history chart's metric selector.
export const TYPED_METRICS: Array<{ key: string; i18nKey: string; unit: string }> = [
  { key: "weight_kg", i18nKey: "flc.v.weight_kg", unit: "kg" },
  { key: "body_fat_pct", i18nKey: "flc.v.body_fat_pct", unit: "%" },
  { key: "fat_free_mass_kg", i18nKey: "flc.v.fat_free_mass_kg", unit: "kg" },
  { key: "bmi", i18nKey: "flc.v.bmi", unit: "" },
  { key: "bmr_kcal", i18nKey: "flc.v.bmr_kcal", unit: "kcal" },
  { key: "waist_hip_ratio", i18nKey: "flc.v.waist_hip_ratio", unit: "" },
  { key: "total_body_water_pct", i18nKey: "flc.v.total_body_water_pct", unit: "%" },
];

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Machine-specific metrics we promote to first-class status (the ones that best
// track a fitness journey). They live in the flexible `extra_metrics` bag — we
// resolve them by key OR label alias so any device's naming maps through.
export const FEATURED = {
  smm: {
    i18nKey: "bodycomp.smm",
    unit: "kg",
    aliases: ["skeletal muscle mass", "skeletal_muscle_mass", "smm", "muscle mass"],
  },
  visceralFat: {
    i18nKey: "bodycomp.visceralFat",
    unit: "",
    aliases: [
      "visceral fat level", "visceral fat area", "visceral fat", "visceral fat grade",
      "visceral_fat_level", "visceral_fat_area", "visceral_fat", "vfl", "vfa",
    ],
  },
  phaseAngle: {
    i18nKey: "bodycomp.phaseAngle",
    unit: "°",
    aliases: ["phase angle", "whole body phase angle", "phase_angle", "whole_body_phase_angle", "pha"],
  },
} as const;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Find a numeric value in an extra_metrics bag matching any of the given aliases
// (checked against both the stored key and its human label). Short aliases
// (< 4 chars, e.g. "smm"/"vfa") require an exact match to avoid false hits.
export function readExtraMetric(
  extra: Record<string, unknown> | null | undefined,
  aliases: readonly string[],
): { value: number; unit: string; label: string } | null {
  if (!extra || typeof extra !== "object") return null;
  const wants = aliases.map(norm);
  for (const [key, v] of Object.entries(extra)) {
    if (key.startsWith("_") || !v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (o.value == null) continue;
    const label = typeof o.label === "string" ? o.label : "";
    const hay = [norm(key), norm(label)];
    const match = wants.some((w) =>
      hay.some((h) => h === w || (w.length >= 4 && (h.includes(w) || w.includes(h)))),
    );
    if (!match) continue;
    const n = Number(o.value);
    if (!Number.isFinite(n)) continue;
    return {
      value: n,
      unit: typeof o.unit === "string" ? o.unit : "",
      label: label || key.replace(/_/g, " "),
    };
  }
  return null;
}

export function patchRow(rows: ExtraMetric[], i: number, patch: Partial<ExtraMetric>): ExtraMetric[] {
  return rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
}

// Fold the editable extra rows (+ machine) into the jsonb object the API stores:
//   { _machine, <key>: { label, value, unit } }
export function buildExtraMetrics(extra: ExtraMetric[], machine: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (machine.trim()) out._machine = machine.trim();
  for (const m of extra) {
    const key = m.key.trim();
    if (!key || key.startsWith("_") || m.value.trim() === "") continue;
    const n = Number(m.value);
    out[key] = {
      label: m.label.trim() || key,
      value: Number.isFinite(n) && m.value.trim() !== "" ? n : m.value.trim(),
      unit: m.unit.trim(),
    };
  }
  return out;
}

// Merge an OCR result into existing typed values + extra rows. Returns the new
// values map (only mapped keys the caller knows about get overwritten), the new
// extra rows, a detected machine (if the caller had none), and a filled count.
export function mergeOcr(
  ocr: InbodyOcr,
  values: Record<string, string>,
  mappedKeys: Set<string>,
  extra: ExtraMetric[],
): { values: Record<string, string>; extra: ExtraMetric[]; machine: string | null; filled: number } {
  const mapped = ocr.mapped ?? {};
  const nextValues = { ...values };
  let filled = 0;
  for (const k of Object.keys(mapped)) {
    if (mappedKeys.has(k) && mapped[k] != null) {
      nextValues[k] = String(mapped[k]);
      filled += 1;
    }
  }

  const existing = new Set(extra.map((m) => m.key));
  const rows: ExtraMetric[] = [];
  for (const e of ocr.extra ?? []) {
    if (!e.key || existing.has(e.key) || mappedKeys.has(e.key)) continue;
    existing.add(e.key);
    rows.push({
      key: e.key,
      label: e.label ?? e.key,
      value: e.value == null ? "" : String(e.value),
      unit: e.unit ?? "",
    });
    filled += 1;
  }

  return {
    values: nextValues,
    extra: rows.length ? [...extra, ...rows] : extra,
    machine: ocr.machine ?? null,
    filled,
  };
}
