import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { T } from "@/lib/design-tokens";
import { getT } from "@/lib/i18n-server";
import FirstLessonCapture, { type DesignedBattery } from "@/components/dashboard/FirstLessonCapture";
import { designFitnessTests } from "@/lib/ai-service";

type Props = { params: Promise<{ id: string }> };

export default async function FirstLessonPage({ params }: Props) {
  const { id } = await params;
  const supabase = await supabaseServer();

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, training_blocked, training_blocked_reason")
    .eq("id", id)
    .single();
  if (!client) notFound();

  const { data: screening } = await supabase
    .from("client_screenings")
    .select("id, parq, medical_history, cvd_risk, parq_yes_count, medical_clearance_required, cvd_risk_factor_count, submitted_at")
    .eq("client_id", id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Ask the Planner agent to design the safest battery for this client.
  // Falls back to a static safe default if the AI service is offline.
  let battery: DesignedBattery | null = null;
  try {
    battery = await designFitnessTests(id);
  } catch {
    battery = null;
  }

  const t = await getT();

  return (
    <div style={{ padding: "22px 28px", display: "flex", flexDirection: "column", gap: 18, maxWidth: 820 }}>
      <Link href={`/clients/${id}`} style={{ fontSize: 11, color: T.accent }}>← {t("fl.backTo")} {client.name}</Link>

      <div className="glass" style={{ borderRadius: 14, padding: "18px 22px" }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{t("fl.pageTitle")} — {client.name}</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
          {t("fl.pageSubtitle")}
        </div>
      </div>

      <FirstLessonCapture
        clientId={id}
        trainingBlocked={!!(client as { training_blocked?: boolean }).training_blocked}
        trainingBlockedReason={(client as { training_blocked_reason?: string }).training_blocked_reason ?? null}
        clearanceRequired={!!screening?.medical_clearance_required}
        betaBlockers={!!(screening?.medical_history as { beta_blockers?: boolean } | null)?.beta_blockers}
        designedBattery={battery}
      />
    </div>
  );
}
