// ============================================================================
// Exercise demonstration images — resolves a catalog exercise to a real
// demonstration photo from the open-source MIT free-exercise-db
// (https://github.com/yuhonas/free-exercise-db), served from jsDelivr's CDN.
//
// SERVER-ONLY: this imports a ~100KB index, so it must only be called from
// server components / route handlers. The pages enrich each ExerciseRow with
// `imageUrl` (+ `imageUrlAlt` for the second frame) before passing rows to the
// client; client components just read those fields and never load the index.
//
// Matching is fuzzy (normalized token overlap, gated by muscle group) so it
// tolerates naming differences. Below a confidence threshold we return null and
// the UI falls back to the anatomical MuscleMap.
// ============================================================================
import index from "./data/free-exercise-index.json";

type Entry = { n: string; m: string[]; i: string[] };
const DB = index as Entry[];

const CDN = "https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/";

const STOP = new Set(["the", "a", "with", "and", "of", "to", "on", "up", "grip"]);
// Light synonym folding so e.g. "Stiff-Legged" ≈ "Stiff", "Pulldown" ≈ "Pull Down".
const SYN: Record<string, string> = {
  dumbbell: "db", barbell: "bb", "stiff-legged": "stiff", legged: "leg",
  pulldown: "pull down", pushup: "push up", biceps: "bicep", triceps: "tricep",
};

// Our scalar muscle_group → the free-exercise-db primaryMuscles vocabulary.
const MG: Record<string, string[]> = {
  chest: ["chest"],
  back: ["lats", "middle back", "lower back", "traps"],
  legs: ["quadriceps", "hamstrings", "glutes", "calves", "abductors", "adductors"],
  core: ["abdominals"],
  shoulders: ["shoulders"],
  arms: ["biceps", "triceps", "forearms"],
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[/\-]/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(s: string): string[] {
  return norm(s).split(" ").map((w) => SYN[w] || w).join(" ").split(" ").filter((w) => w && !STOP.has(w));
}

// Precompute token sets once per module load.
const PREP = DB.map((e) => ({ ...e, t: new Set(tokens(e.n)) }));

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  a.forEach((x) => { if (b.has(x)) inter++; });
  return inter / (a.size + b.size - inter || 1);
}

export type ExerciseImage = { url: string; alt: string | null };

/**
 * Best-effort demonstration photo for an exercise. Returns null when no
 * confident match exists (caller falls back to the MuscleMap).
 */
export function resolveExerciseImage(name: string, muscleGroup?: string | null): ExerciseImage | null {
  if (!name) return null;
  const at = new Set(tokens(name));
  if (at.size === 0) return null;
  const okMuscles = new Set(muscleGroup ? MG[muscleGroup] ?? [] : []);

  let best: (typeof PREP)[number] | null = null;
  let bestScore = 0;
  for (const e of PREP) {
    let s = jaccard(at, e.t);
    const muscleOk = e.m.some((m) => okMuscles.has(m));
    s += muscleOk ? 0.15 : -0.1; // nudge toward / away from the right muscle group
    if (s > bestScore) { bestScore = s; best = e; }
  }

  if (!best || bestScore < 0.4) return null;
  return {
    url: CDN + best.i[0],
    alt: best.i[1] ? CDN + best.i[1] : null,
  };
}
