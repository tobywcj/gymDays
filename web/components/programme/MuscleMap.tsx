"use client";

// Anatomical muscle map rendered with react-body-highlighter (MIT). Front +
// back figures with the worked muscles colour-coded: primary = terracotta,
// secondary = moss. Public API (MuscleMap, MuscleIcon, MUSCLE_LABELS,
// GROUP_ICON, MuscleLegend) is unchanged, so callers don't need to change.
import Model, { type IExerciseData, type Muscle } from "react-body-highlighter";
import { T } from "@/lib/design-tokens";
import type { MuscleRegion } from "@/lib/exercise-library";
import { useI18n } from "@/lib/i18n-context";

// Our finer MuscleRegion vocabulary → the library's muscle slugs. Some of ours
// are more granular than the library, so a few collapse (rhomboids → upper-back,
// erectors → lower-back, side-delts shows on both deltoid groups).
const SLUG: Record<MuscleRegion, Muscle[]> = {
  chest: ["chest"],
  "front-delts": ["front-deltoids"],
  "side-delts": ["front-deltoids", "back-deltoids"],
  "rear-delts": ["back-deltoids"],
  biceps: ["biceps"],
  triceps: ["triceps"],
  forearms: ["forearm"],
  lats: ["upper-back"],
  traps: ["trapezius"],
  rhomboids: ["upper-back"],
  erectors: ["lower-back"],
  abs: ["abs"],
  obliques: ["obliques"],
  quads: ["quadriceps"],
  hamstrings: ["hamstring"],
  glutes: ["gluteal"],
  calves: ["calves"],
};

const uniq = <X,>(xs: X[]) => Array.from(new Set(xs));
const toSlugs = (regions: MuscleRegion[]): Muscle[] => uniq(regions.flatMap((r) => SLUG[r] ?? []));

// Faint body silhouette colour that reads on the dark glass cards.
const BODY = "rgba(244,237,226,0.16)";

export const MUSCLE_LABELS: Record<MuscleRegion, { en: string; zh: string }> = {
  chest: { en: "Chest", zh: "胸大肌" },
  "front-delts": { en: "Front delts", zh: "前三角肌" },
  "side-delts": { en: "Side delts", zh: "中三角肌" },
  "rear-delts": { en: "Rear delts", zh: "後三角肌" },
  biceps: { en: "Biceps", zh: "肱二頭肌" },
  triceps: { en: "Triceps", zh: "肱三頭肌" },
  forearms: { en: "Forearms", zh: "前臂" },
  lats: { en: "Lats", zh: "背闊肌" },
  traps: { en: "Trapezius", zh: "斜方肌" },
  rhomboids: { en: "Rhomboids", zh: "菱形肌" },
  erectors: { en: "Erector spinae", zh: "豎脊肌" },
  abs: { en: "Abs", zh: "腹直肌" },
  obliques: { en: "Obliques", zh: "腹斜肌" },
  quads: { en: "Quads", zh: "股四頭肌" },
  hamstrings: { en: "Hamstrings", zh: "膕繩肌" },
  glutes: { en: "Glutes", zh: "臀大肌" },
  calves: { en: "Calves", zh: "小腿" },
};

// Representative muscles + view per Programme group, for the anatomical filter row.
export const GROUP_ICON: Record<string, { regions: MuscleRegion[]; view: "front" | "back" }> = {
  chest: { regions: ["chest"], view: "front" },
  back: { regions: ["lats", "traps", "rhomboids"], view: "back" },
  legs: { regions: ["quads"], view: "front" },
  core: { regions: ["abs", "obliques"], view: "front" },
  shoulders: { regions: ["front-delts", "side-delts"], view: "front" },
  arms: { regions: ["biceps"], view: "front" },
};

// Single-figure highlight used as a filter-row icon.
export function MuscleIcon({ regions, view = "front", size = 46, active = false }: {
  regions: MuscleRegion[]; view?: "front" | "back"; size?: number; active?: boolean;
}) {
  const color = active ? "#e4c08c" : T.accent;
  const data: IExerciseData[] = [{ name: "icon", muscles: toSlugs(regions) }];
  return (
    <Model
      type={view === "front" ? "anterior" : "posterior"}
      data={data}
      bodyColor="rgba(244,237,226,0.12)"
      highlightedColors={[color]}
      style={{ height: size, width: size / 2 }}
    />
  );
}

type Props = {
  primary: MuscleRegion[];
  secondary?: MuscleRegion[];
  size?: number; // pixel height
};

export default function MuscleMap({ primary, secondary = [], size = 120 }: Props) {
  const primarySlugs = toSlugs(primary);
  const primarySet = new Set(primarySlugs);
  const secondarySlugs = toSlugs(secondary).filter((s) => !primarySet.has(s));

  // Frequency drives the colour: primaries appear in 2 entries (→ highlightedColors[1]),
  // secondaries in 1 (→ highlightedColors[0]).
  const data: IExerciseData[] = [
    { name: "primary-a", muscles: primarySlugs },
    { name: "primary-b", muscles: primarySlugs },
    { name: "secondary", muscles: secondarySlugs },
  ];
  const colors = [T.accentMoss, T.accent];
  const figure = (type: "anterior" | "posterior") => (
    <Model type={type} data={data} bodyColor={BODY} highlightedColors={colors} style={{ height: size, width: size / 2 }} />
  );

  return (
    <div style={{ display: "flex", gap: 4, justifyContent: "center", alignItems: "center" }} role="img" aria-label="Muscle map">
      {figure("anterior")}
      {figure("posterior")}
    </div>
  );
}

export function MuscleLegend() {
  const { t } = useI18n();
  const dot = (color: string) => (
    <span style={{ width: 9, height: 9, borderRadius: 3, background: color, display: "inline-block" }} />
  );
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 10, color: T.muted }}>
      <span style={{ display: "flex", gap: 5, alignItems: "center" }}>{dot(T.accent)} {t("programme.primary")}</span>
      <span style={{ display: "flex", gap: 5, alignItems: "center" }}>{dot(T.accentMoss)} {t("programme.secondary")}</span>
    </div>
  );
}
