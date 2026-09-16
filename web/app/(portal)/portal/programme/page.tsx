import { redirect } from "next/navigation";
import { T } from "@/lib/design-tokens";
import { supabaseServer } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth/viewer";
import { getT } from "@/lib/i18n-server";
import { fetchClientHealth } from "@/lib/client-health";
import { assessSuitability, type Suitability } from "@/lib/exercise-suitability";
import { resolveExerciseImage } from "@/lib/exercise-images";
import type { ExerciseRow, AftLevel } from "@/lib/exercise-library";
import ProgrammeLibrary from "@/components/programme/ProgrammeLibrary";

export const dynamic = "force-dynamic";

const COLS =
  "id, name, name_zh, muscle_group, primary_muscles, secondary_muscles, equipment, equipment_options, level, aft_level, tempo, key_points, progression, regression, common_faults, variations, citation, source, illustration_url";

export default async function PortalProgrammePage() {
  const viewer = await getViewer();
  if (viewer.role !== "client") redirect("/");
  const clientId = viewer.clientIds[0];

  const supabase = await supabaseServer();
  const t = await getT();

  // trainer_exercise_flags_client_read RLS scopes these to the client's trainer(s).
  const [{ data: rows }, { data: flags }, { data: client }] = await Promise.all([
    supabase.from("exercise_db").select(COLS).order("muscle_group", { ascending: true }).order("name", { ascending: true }).returns<ExerciseRow[]>(),
    supabase.from("trainer_exercise_flags").select("exercise_id").returns<{ exercise_id: string }[]>(),
    supabase.from("clients").select("name, aft_level, aft_rationale, aft_signals, aft_classified_at").eq("id", clientId)
      .maybeSingle<{ name: string; aft_level: string | null; aft_rationale: string | null; aft_signals: { label: string; value: string }[] | null; aft_classified_at: string | null }>(),
  ]);

  // Health load is fallible — on a data-source error, flag it so the badges show
  // an error rather than computing a misleading "suitable" from empty health.
  let health: Awaited<ReturnType<typeof fetchClientHealth>> = null;
  let healthError = false;
  try { health = await fetchClientHealth(supabase, clientId); }
  catch { healthError = true; }

  // Compute caveats server-side (the portal client can't write to the store).
  const caveats: Record<string, Suitability> = {};
  if (!healthError) for (const ex of rows ?? []) caveats[ex.id] = assessSuitability(ex, health);

  // Attach a demonstration photo to each exercise (free-exercise-db, server-side).
  const enriched = (rows ?? []).map((r) => {
    const img = resolveExerciseImage(r.name, r.muscle_group);
    const illustrationUrl = (r as { illustration_url?: string | null }).illustration_url ?? null;
    return { ...r, illustrationUrl, imageUrl: img?.url ?? null, imageUrlAlt: img?.alt ?? null };
  });

  return (
    <>
      <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>{t("programme.pageTitle")}</div>
      <div style={{ fontSize: 12, color: T.muted }}>{t("programme.portalSubtitle")}</div>

      <ProgrammeLibrary
        rows={enriched}
        initialFlaggedIds={(flags ?? []).map((f) => f.exercise_id)}
        clients={[]}
        initialClientId={clientId}
        initialHealth={health}
        initialCaveats={caveats}
        initialCaveatError={healthError}
        initialAft={client ? {
          aft_level: (client.aft_level as AftLevel | null) ?? null,
          aft_rationale: client.aft_rationale ?? null,
          aft_signals: client.aft_signals ?? null,
          aft_classified_at: client.aft_classified_at ?? null,
        } : null}
        fixedClientName={client?.name ?? null}
        readOnly
      />
    </>
  );
}
