import Link from "next/link";
import { notFound } from "next/navigation";
import { T } from "@/lib/design-tokens";
import { supabaseServer } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n-server";
import { listLLMs } from "@/lib/ai-service";
import ProgramPanel from "@/components/dashboard/ProgramPanel";
import MealPlanPanel from "@/components/dashboard/MealPlanPanel";
import LastSessionCard from "@/components/dashboard/LastSessionCard";

type ProgramRow = {
  id: string;
  week_start: string;
  plan: { days: Array<{ day: string; focus: string; exercises: Array<{ exercise_id: string; sets: number | string; reps: number | string; notes?: string }> }> };
};

type MealPlanRow = {
  id: string;
  week_start: string;
  plan: {
    daily_targets: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
    days: Array<{
      day: string;
      meals: Array<{ name: string; items: Array<{ food: string; grams: number; kcal: number; protein_g: number; carbs_g: number; fat_g: number }>; kcal_total?: number }>;
      day_total: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
    }>;
  };
};

type ExerciseRow = { id: string; name: string; muscle_group: string | null };

// Shared fixed card height (matches the client detail page + portal).
const CARD_H = 460;

export default async function ClientProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();

  const { data: client } = await supabase
    .from("clients").select("id, name, goal").eq("id", id).single();
  if (!client) notFound();

  const [{ data: program }, { data: mealPlan }] = await Promise.all([
    supabase
      .from("programs")
      .select("id, week_start, plan")
      .eq("client_id", id)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle<ProgramRow>(),
    supabase
      .from("meal_plans")
      .select("id, week_start, plan")
      .eq("client_id", id)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle<MealPlanRow>(),
  ]);

  // Look up exercise names for everything referenced by the latest plan.
  // Be defensive — old or partial plans may not have the canonical shape.
  const planDays = program?.plan?.days ?? [];
  const referencedIds = Array.from(new Set(
    planDays.flatMap((d) => (d?.exercises ?? []).map((e) => e?.exercise_id).filter(Boolean) as string[])
  ));

  let exercises: ExerciseRow[] = [];
  if (referencedIds.length > 0) {
    const { data } = await supabase
      .from("exercise_db")
      .select("id, name, muscle_group")
      .in("id", referencedIds)
      .returns<ExerciseRow[]>();
    exercises = data ?? [];
  }

  const llms = await listLLMs();
  const t = await getT();

  return (
    <div style={{ padding: "22px 28px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
      <Link href={`/clients/${id}`} style={{ fontSize: 11, color: T.accent }}>← {client.name}</Link>

      <div className="glass" style={{ borderRadius: T.radius.card, padding: 24, flexShrink: 0 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("prog.pageTitle")} — {client.name}</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
          {t("prog.goal")} {client.goal || <em style={{ color: T.muted }}>{t("prog.notSet")}</em>}
        </div>
      </div>

      <div style={{ height: CARD_H }}>
        <LastSessionCard clientId={client.id} llms={llms} />
      </div>

      <div style={{ height: CARD_H }}>
        <ProgramPanel
          clientId={client.id}
          program={program ?? null}
          exercises={exercises}
          llms={llms}
        />
      </div>

      <div style={{ height: CARD_H }}>
        <MealPlanPanel
          clientId={client.id}
          mealPlan={mealPlan ?? null}
          llms={llms}
        />
      </div>
    </div>
  );
}
