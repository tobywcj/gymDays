import Link from "next/link";
import { notFound } from "next/navigation";
import { T } from "@/lib/design-tokens";
import { supabaseServer } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n-server";
import { listLLMs, listMessagingProviders } from "@/lib/ai-service";
import StatusBadge from "@/components/dashboard/StatusBadge";
import AftBadge from "@/components/programme/AftBadge";
import type { AftLevel } from "@/lib/exercise-library";
import StravaActivityChart from "@/components/dashboard/StravaActivityChart";
import ProgressPanel from "@/components/dashboard/ProgressPanel";
import HRHealthPanel from "@/components/dashboard/HRHealthPanel";
import LastSessionCard from "@/components/dashboard/LastSessionCard";
import ProgramPanel from "@/components/dashboard/ProgramPanel";
import MealPlanPanel from "@/components/dashboard/MealPlanPanel";
import MessagingPanel from "@/components/dashboard/MessagingPanel";
import LanguageToggle from "@/components/dashboard/LanguageToggle";
import AgentKnowledgeMap from "@/components/dashboard/AgentKnowledgeMap";
import ScreeningSummary, { type ScreeningRow, type ClearanceState } from "@/components/dashboard/ScreeningSummary";
import InjuryStatusCard, { type InjuryLogEntry } from "@/components/dashboard/InjuryStatusCard";
import FirstLessonChecklist from "@/components/dashboard/FirstLessonChecklist";
import RequestsPanel from "@/components/dashboard/RequestsPanel";
import BodyCompositionPanel, { type HealthMetricsRow } from "@/components/dashboard/BodyCompositionPanel";
import InsightTree from "@/components/portal/InsightTree";

// Every content panel on the client page sizes to its own content — cards hug
// what they contain rather than padding out to a shared fixed height.

type Activity = {
  id: string;
  source: string;
  external_id: string;
  started_at: string;
  type: string | null;
  distance_m: number | null;
  duration_s: number | null;
  metrics: Record<string, unknown> | null;
};

export default async function ClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const t = await getT();

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, email, trainer_id, goal, status, strava_athlete_id, telegram_chat_id, language, training_blocked, training_blocked_reason, clearance_received_at, clearance_note, injury_history, aft_level")
    .eq("id", id)
    .single();
  if (!client) notFound();

  const [
    activityResp, tokenResp, progressResp,
    mealPlanResp, messagesResp,
    llms, providers,
  ] = await Promise.all([
    supabase
      .from("activities")
      .select("id, source, external_id, started_at, type, distance_m, duration_s, metrics")
      .eq("client_id", id)
      .order("started_at", { ascending: false })
      .limit(200)
      .returns<Activity[]>(),
    supabase
      .from("integration_tokens")
      .select("id").eq("client_id", id).eq("provider", "strava").maybeSingle(),
    supabase
      .from("progress_reports")
      .select("id, period_start, period_end, summary, flags, created_at")
      .eq("client_id", id)
      // Freshest first by when it was generated — reports can share a period_end,
      // so order by created_at to always surface the most recent run.
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("meal_plans")
      .select("week_start, plan")
      .eq("client_id", id)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("messages")
      .select("id, direction, channel, body, status, sent_at, to_address")
      .eq("client_id", id)
      .order("sent_at", { ascending: false })
      .limit(100),
    listLLMs(),
    listMessagingProviders(client.trainer_id),
  ]);

  const [screeningResp, fitnessResp, requestsResp, injuryLogResp, programResp, exerciseResp, healthResp, agentPrefsResp] = await Promise.all([
    supabase
      .from("client_screenings")
      .select("id, parq, medical_history, cvd_risk, parq_yes_count, medical_clearance_required, cvd_risk_factor_count, submitted_at")
      .eq("client_id", id)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("fitness_assessments")
      .select("id")
      .eq("client_id", id)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("program_change_requests")
      .select("id, body, status, trainer_note, created_at, resolved_at")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("client_injury_log")
      .select("id, source, note, created_at, resolved_at")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("programs")
      .select("week_start, plan")
      .eq("client_id", id)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Lookup table so the planner card can resolve exercise_id → name.
    supabase
      .from("exercise_db")
      .select("id, name, muscle_group")
      .order("name", { ascending: true })
      .returns<{ id: string; name: string; muscle_group: string | null }[]>(),
    // InBody / BIA reading history (typed columns + machine-specific extras),
    // newest first — powers the latest-reading tiles and the trend chart.
    supabase
      .from("client_health_metrics")
      .select("id, recorded_at, source, weight_kg, bmi, body_fat_pct, fat_free_mass_kg, bmr_kcal, waist_hip_ratio, total_body_water_pct, extra_metrics")
      .eq("client_id", id)
      .order("recorded_at", { ascending: false })
      .limit(60),
    // Per-agent data-source toggles (see AgentKnowledgeMap). Isolated query so a
    // pre-migration missing column surfaces as .error here, not a page crash.
    supabase
      .from("clients")
      .select("agent_source_prefs")
      .eq("id", id)
      .maybeSingle(),
  ]);
  const agentSourcePrefs = ((agentPrefsResp.data as { agent_source_prefs?: unknown } | null)?.agent_source_prefs
    ?? {}) as Record<string, Record<string, boolean>>;
  const screening = (screeningResp.data ?? null) as ScreeningRow | null;
  const injuryTrail = (injuryLogResp.data ?? []) as InjuryLogEntry[];
  const mh = (screening?.medical_history ?? {}) as { previous_injuries?: unknown };
  const reportedInjuryList = Array.isArray(mh.previous_injuries)
    ? (mh.previous_injuries as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const hasFirstLesson = !!fitnessResp.data;
  const requests = (requestsResp.data ?? []) as Parameters<typeof RequestsPanel>[0]["initial"];
  const bodyCompHistory = (healthResp.data ?? []) as HealthMetricsRow[];

  const activities   = activityResp.data ?? [];
  const stravaConnected = !!tokenResp.data;
  const stravaConfigured = !!process.env.STRAVA_CLIENT_ID;
  const progressReport = progressResp.data ?? null;
  const mealPlan     = mealPlanResp.data ?? null;
  const messages     = messagesResp.data ?? [];
  const providerMap  = providers?.providers ?? null;
  const program      = (programResp.data ?? null) as Parameters<typeof ProgramPanel>[0]["program"];
  const exerciseLib  = exerciseResp.data ?? [];

  return (
    <div style={{ padding: "22px 28px", display: "flex", flexDirection: "column", gap: 18 }}>
      <Link href="/" style={{ fontSize: 11, color: T.accent }}>{t("client.back")}</Link>

      {/* ── Client header ────────────────────────────────────────── */}
      <div className="glass" style={{ borderRadius: T.radius.card, padding: "18px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: "1 1 220px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{client.name}</div>
              {client.aft_level && <AftBadge level={client.aft_level as AftLevel} />}
            </div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
              {client.goal || <em style={{ color: T.muted }}>{t("client.noGoal")}</em>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <LanguageToggle
              clientId={client.id}
              initial={(client.language === "zh" ? "zh" : "en") as "en" | "zh"}
            />
            <StatusBadge status={client.status} />
          </div>
        </div>

        {/* Per-agent data-source control: toggles here gate the tools each agent
            gets when generating output (persisted to clients.agent_source_prefs). */}
        <AgentKnowledgeMap clientId={client.id} initialPrefs={agentSourcePrefs} />
      </div>

      {requests.length > 0 && <RequestsPanel initial={requests} />}

      {/* ── Screening + first-lesson guidance ───────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gridAutoRows: "minmax(0, auto)", alignItems: "start", gap: 14 }}>
        <ScreeningSummary
          screening={screening}
          clientId={client.id}
          injuryStatus={(client as { injury_history?: string | null }).injury_history ?? null}
          clearance={{
            clearance_received_at: (client as { clearance_received_at?: string | null }).clearance_received_at ?? null,
            clearance_note: (client as { clearance_note?: string | null }).clearance_note ?? null,
          } as ClearanceState}
        />
        <FirstLessonChecklist
          clientId={client.id}
          screening={screening}
          trainingBlocked={!!(client as { training_blocked?: boolean }).training_blocked}
          hasFirstLesson={hasFirstLesson}
        />
        <InjuryStatusCard
          clientId={client.id}
          official={(client as { injury_history?: string | null }).injury_history ?? null}
          reported={reportedInjuryList}
          trail={injuryTrail}
        />
      </div>

      {/* ── Body composition (latest reading + trend chart + log new) ── */}
      <BodyCompositionPanel history={bodyCompHistory} clientId={id} />

      {/* ── Health metrics chart (flexible height — grows with content) ── */}
      <StravaActivityChart
        activities={activities}
        clientId={id}
        clientName={client.name}
        connected={stravaConnected}
        athleteId={client.strava_athlete_id ?? null}
        stravaConfigured={stravaConfigured}
        goal={client.goal ?? null}
      />

      {/* ── HR Zone Health (flexible height — grows with content) ── */}
      <HRHealthPanel clientId={id} llms={llms} />

      {/* ── Progress agent (flexible height — grows with content) ── */}
      <ProgressPanel
        clientId={client.id}
        report={progressReport as Parameters<typeof ProgressPanel>[0]["report"]}
        llms={llms}
        autoRun
      />

      {/* ── Last-session analysis (flexible height — grows with content) ── */}
      <LastSessionCard clientId={client.id} llms={llms} />

      {/* ── Weekly program: planner agent builds it from the recent journey +
          body status (exercise library used to resolve exercise_id → name). ── */}
      <ProgramPanel
        clientId={client.id}
        program={program}
        exercises={exerciseLib}
        llms={llms}
      />

      {/* ── Nutrition agent (on demand) ─────────────────────────── */}
      <MealPlanPanel
        clientId={client.id}
        mealPlan={mealPlan as Parameters<typeof MealPlanPanel>[0]["mealPlan"]}
        llms={llms}
      />

      {/* ── Messaging portal (flexible height — grows with content) ── */}
      <MessagingPanel
        clientId={client.id}
        clientEmail={client.email ?? null}
        initialMessages={messages as Parameters<typeof MessagingPanel>[0]["initialMessages"]}
        providers={providerMap}
      />

      {/* ── Insight tree: the same "Understand your body" mind-map the client
          sees on their portal, previewed here for the client the trainer owns. ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>{t("insight.title")}</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{t("insight.subtitle")}</div>
        </div>
        <InsightTree clientName={client.name} clientGoal={client.goal ?? null} clientId={client.id} />
      </div>

    </div>
  );
}
