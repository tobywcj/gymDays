import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth/viewer";
import { fetchClientHealth } from "@/lib/client-health";
import { assessSuitability } from "@/lib/exercise-suitability";
import type { ExerciseRow } from "@/lib/exercise-library";

const COLS = "id, muscle_group, equipment, level, primary_muscles, secondary_muscles";

// Compute the per-exercise suitability map for a client (from injury_history +
// screening), STORE it (trainer only), and return it for the badges.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (viewer.role === "none") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = await supabaseServer();
  const { data: client } = await supabase
    .from("clients").select("id, trainer_id").eq("id", id).maybeSingle<{ id: string; trainer_id: string }>();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (viewer.role === "client" && !viewer.clientIds.includes(id)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // If the health/screening data source breaks, surface a hard error — do NOT
  // fall through to computing suitability from empty health (that would label
  // every exercise "suitable", including ones that load an injured area).
  let health;
  try {
    health = await fetchClientHealth(supabase, id);
  } catch (e) {
    return NextResponse.json({ error: "health_unavailable", detail: (e as Error).message }, { status: 500 });
  }
  const { data: rows } = await supabase.from("exercise_db").select(COLS).returns<ExerciseRow[]>();

  const caveats: Record<string, { level: string; reasons: string[] }> = {};
  for (const ex of rows ?? []) {
    caveats[ex.id] = assessSuitability(ex, health);
  }

  // Persist (trainer only — RLS enforces trainer_id = auth.uid()).
  if (viewer.role === "trainer" && client.trainer_id === viewer.userId) {
    const upsertRows = (rows ?? []).map((ex) => ({
      trainer_id: viewer.userId,
      client_id: id,
      exercise_id: ex.id,
      level: caveats[ex.id].level,
      reasons: caveats[ex.id].reasons,
      computed_at: new Date().toISOString(),
    }));
    if (upsertRows.length) {
      await supabase.from("client_exercise_caveats").upsert(upsertRows, { onConflict: "client_id,exercise_id" });
    }
  }

  return NextResponse.json({ health, caveats });
}
