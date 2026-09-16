import { supabaseServer } from "@/lib/supabase/server";
import { fetchClientHealth } from "@/lib/client-health";
import { resolveExerciseImage } from "@/lib/exercise-images";
import { illustrationProviders } from "@/lib/exercise-illustration";
import { getTrainerSecrets } from "@/lib/trainer-secrets";
import type { ExerciseRow, AftLevel } from "@/lib/exercise-library";
import ProgrammeLibrary from "@/components/programme/ProgrammeLibrary";

export const dynamic = "force-dynamic";

export type AftState = {
  aft_level: AftLevel | null;
  aft_rationale: string | null;
  aft_signals: { label: string; value: string }[] | null;
  aft_classified_at: string | null;
};

const COLS =
  "id, name, name_zh, muscle_group, primary_muscles, secondary_muscles, equipment, equipment_options, level, aft_level, tempo, key_points, progression, regression, common_faults, variations, citation, source, illustration_url";

export default async function ProgrammePage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client: clientParam } = await searchParams;
  const supabase = await supabaseServer();

  const [{ data: rows }, { data: flags }, { data: clients }] = await Promise.all([
    supabase.from("exercise_db").select(COLS).order("muscle_group", { ascending: true }).order("name", { ascending: true }).returns<ExerciseRow[]>(),
    supabase.from("trainer_exercise_flags").select("exercise_id").returns<{ exercise_id: string }[]>(),
    supabase.from("clients").select("id, name").order("name", { ascending: true }).returns<{ id: string; name: string }[]>(),
  ]);

  const initialClientId = clientParam ?? null;
  // Don't let a health/screening data-source error crash SSR — flag it so the
  // cards render an explicit error badge instead of a misleading "suitable".
  let initialHealth: Awaited<ReturnType<typeof fetchClientHealth>> = null;
  let healthError = false;
  let initialAft: AftState | null = null;
  if (initialClientId) {
    try { initialHealth = await fetchClientHealth(supabase, initialClientId); }
    catch { healthError = true; }
    const { data: c } = await supabase
      .from("clients")
      .select("aft_level, aft_rationale, aft_signals, aft_classified_at")
      .eq("id", initialClientId)
      .maybeSingle<AftState>();
    initialAft = c ?? null;
  }
  // Trainer's bring-your-own keys drive which illustration providers show "ready".
  const { data: { user } } = await supabase.auth.getUser();
  const secrets = user ? await getTrainerSecrets(supabase, user.id) : {};

  // Attach a demonstration photo to each exercise (free-exercise-db, server-side).
  const enriched = (rows ?? []).map((r) => {
    const img = resolveExerciseImage(r.name, r.muscle_group);
    const illustrationUrl = (r as { illustration_url?: string | null }).illustration_url ?? null;
    return { ...r, illustrationUrl, imageUrl: img?.url ?? null, imageUrlAlt: img?.alt ?? null };
  });

  return (
    <div style={{ padding: "22px 28px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
      <ProgrammeLibrary
        rows={enriched}
        initialFlaggedIds={(flags ?? []).map((f) => f.exercise_id)}
        clients={clients ?? []}
        initialClientId={initialClientId}
        initialHealth={initialHealth}
        initialCaveatError={healthError}
        initialAft={initialAft}
        imgProviders={illustrationProviders(secrets)}
      />
    </div>
  );
}
