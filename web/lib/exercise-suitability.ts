// Cheap, structured per-client suitability check for an exercise — NO LLM.
//
// When a client is in context on the Programme page, each card shows a badge
// (ok / caution / avoid) derived from the client's injury_history + screening
// matched against the exercise's target muscle regions, level and known faults.
// The nuanced explanation + alternatives come on demand from the planner-agent
// coach (mode="caveat"); this just keeps the ~70-card grid instant.
import type { ExerciseRow, MuscleRegion } from "./exercise-library";

export type SuitabilityLevel = "ok" | "caution" | "avoid";

// Minimal health snapshot the dashboard/portal passes in. All optional so the
// badge degrades gracefully when little is known.
export type ClientHealth = {
  injuryHistory?: string | null;
  medicalClearanceRequired?: boolean | null;
  cvdRiskFactorCount?: number | null;
  betaBlockers?: boolean | null;
};

export type Suitability = { level: SuitabilityLevel; reasons: string[] };

// Body-area keywords (EN + common ZH) → the muscle regions / joints they stress.
// A hit means the exercise loads an area the client flagged as injured.
const AREA_RULES: { keywords: string[]; regions: MuscleRegion[]; joint: string }[] = [
  { keywords: ["shoulder", "rotator", "肩", "膊"], regions: ["front-delts", "side-delts", "rear-delts", "chest"], joint: "shoulder" },
  { keywords: ["knee", "acl", "mcl", "膝", "menisc"], regions: ["quads", "hamstrings", "glutes", "calves"], joint: "knee" },
  { keywords: ["back", "lumbar", "spine", "disc", "腰", "背", "脊"], regions: ["erectors", "lats"], joint: "lower back" },
  { keywords: ["hip", "髖", "groin"], regions: ["glutes", "hamstrings", "quads"], joint: "hip" },
  { keywords: ["elbow", "肘", "tennis", "golfer"], regions: ["biceps", "triceps", "forearms"], joint: "elbow" },
  { keywords: ["wrist", "腕", "carpal"], regions: ["forearms"], joint: "wrist" },
  { keywords: ["neck", "cervical", "頸"], regions: ["traps"], joint: "neck" },
  { keywords: ["ankle", "踝", "achilles"], regions: ["calves"], joint: "ankle" },
];

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

export function assessSuitability(ex: ExerciseRow, health: ClientHealth | null | undefined): Suitability {
  if (!health) return { level: "ok", reasons: [] };

  const reasons: string[] = [];
  let level: SuitabilityLevel = "ok";
  const bump = (next: SuitabilityLevel) => {
    const rank = { ok: 0, caution: 1, avoid: 2 } as const;
    if (rank[next] > rank[level]) level = next;
  };

  const injury = norm(health.injuryHistory);
  const targets = new Set<MuscleRegion>([...(ex.primary_muscles ?? []), ...(ex.secondary_muscles ?? [])]);

  if (injury && injury !== "none" && injury !== "nil" && injury !== "無") {
    for (const rule of AREA_RULES) {
      if (!rule.keywords.some((k) => injury.includes(k))) continue;
      const stressesPrimary = (ex.primary_muscles ?? []).some((m) => rule.regions.includes(m));
      const stressesAny = rule.regions.some((r) => targets.has(r));
      if (stressesPrimary) {
        bump("avoid");
        reasons.push(`Directly loads the ${rule.joint} — flagged in injury history.`);
      } else if (stressesAny) {
        bump("caution");
        reasons.push(`Involves the ${rule.joint} as a secondary mover — flagged in injury history.`);
      }
    }
  }

  // Intensity classification (mirrors the planner's safety invariants).
  const HEAVY_COMPOUND = new Set(["chest", "back", "legs"]);
  const isCompoundLoaded = ex.equipment === "barbell" && (ex.primary_muscles ?? []).length >= 1 && HEAVY_COMPOUND.has(ex.muscle_group ?? "");
  const isConditioning = ex.equipment === "battle-ropes" || ex.equipment === "suspension" || ex.muscle_group === "full-body";
  const isHighIntensity = ex.level === "advanced" || isCompoundLoaded || isConditioning;
  const isMachineOrIsolation = ex.equipment === "machine" || (ex.muscle_group === "arms");

  // Medical clearance required (PAR-Q positive, incl. heart condition): cap intensity.
  if (health.medicalClearanceRequired) {
    if (isHighIntensity) {
      bump("avoid");
      reasons.push("Medical clearance required — avoid high-intensity / max-effort loading until cleared.");
    } else if (!isMachineOrIsolation) {
      bump("caution");
      reasons.push("Medical clearance required — keep effort sub-maximal (RPE ≤ 6) and supervise.");
    }
  }
  if ((health.cvdRiskFactorCount ?? 0) >= 2 && isHighIntensity) {
    bump("caution");
    reasons.push("≥2 CVD risk factors — sub-maximal effort only.");
  }
  if (health.betaBlockers && isConditioning) {
    bump("caution");
    reasons.push("On beta-blockers — gauge cardio by RPE (13–15), not heart rate.");
  }

  return { level, reasons };
}

export const SUITABILITY_EMOJI: Record<SuitabilityLevel, string> = {
  ok: "✅",
  caution: "⚠️",
  avoid: "⛔",
};
