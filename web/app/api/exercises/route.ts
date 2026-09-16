import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Trainer-only: add a new exercise to the global exercise_db. The row is usually
// a candidate produced by the exercise-research flow and reviewed by the trainer.
//
// exercise_db writes are service-role only (RLS), so we authenticate the trainer
// with their session client, then write with the admin client. Rows added this
// way are tagged source='trainer' so they're distinguishable from the AASFP seed.

const GROUPS = new Set(["chest", "back", "legs", "core", "shoulders", "arms"]);
const REGIONS = new Set([
  "chest", "front-delts", "side-delts", "rear-delts", "biceps", "triceps", "forearms",
  "lats", "traps", "rhomboids", "erectors", "abs", "obliques", "quads", "hamstrings",
  "glutes", "calves",
]);

function cleanRegions(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && REGIONS.has(x));
}
function cleanStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: trainer } = await supabase
    .from("trainers").select("id").eq("id", user.id).maybeSingle();
  if (!trainer) return NextResponse.json({ error: "trainer_not_found" }, { status: 404 });

  const ex = await req.json().catch(() => null);
  if (!ex || typeof ex !== "object") return NextResponse.json({ error: "bad_body" }, { status: 400 });

  const name = typeof ex.name === "string" ? ex.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const muscleGroup = typeof ex.muscle_group === "string" ? ex.muscle_group : null;
  if (!muscleGroup || !GROUPS.has(muscleGroup)) {
    return NextResponse.json({ error: "muscle_group must be one of chest|back|legs|core|shoulders|arms" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  // Guard against an obvious exact-name duplicate.
  const { data: dupe } = await admin
    .from("exercise_db").select("id").ilike("name", name).maybeSingle();
  if (dupe) return NextResponse.json({ error: "duplicate_name", id: dupe.id }, { status: 409 });

  const row = {
    name,
    name_zh: typeof ex.name_zh === "string" ? ex.name_zh : null,
    muscle_group: muscleGroup,
    primary_muscles: cleanRegions(ex.primary_muscles),
    secondary_muscles: cleanRegions(ex.secondary_muscles),
    equipment: typeof ex.equipment === "string" ? ex.equipment : null,
    equipment_options: cleanStrings(ex.equipment_options),
    level: ["beginner", "intermediate", "advanced"].includes(ex.level) ? ex.level : null,
    difficulty: typeof ex.difficulty === "number" ? ex.difficulty : null,
    tempo: typeof ex.tempo === "string" ? ex.tempo : null,
    cues: typeof ex.cues === "string" ? ex.cues : null,
    key_points: ex.key_points ?? null,
    progression: ex.progression ?? null,
    regression: ex.regression ?? null,
    common_faults: Array.isArray(ex.common_faults) ? ex.common_faults : [],
    variations: Array.isArray(ex.variations) ? ex.variations : [],
    source: "trainer",
  };

  const { data, error } = await admin
    .from("exercise_db").insert(row).select("id, name").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.id, name: data.name });
}
