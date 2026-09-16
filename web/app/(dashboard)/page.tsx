import MetricCard from "@/components/dashboard/MetricCard";
import AvatarStack from "@/components/dashboard/AvatarStack";
import { ClientsIcon, ClockIcon, HeartPulseIcon, BellIcon, CheckIcon } from "@/components/dashboard/icons";
import ScheduledAgents from "@/components/dashboard/ScheduledAgents";
import PendingInvitesStrip from "@/components/dashboard/PendingInvitesStrip";
import SessionCalendar from "@/components/dashboard/SessionCalendar";
import { supabaseServer } from "@/lib/supabase/server";
import { getLocale, getT } from "@/lib/i18n-server";
import { buildSessions, sessionsToCalendar, type ProgramRow, type ExerciseRow, type SessionRow } from "@/lib/sessions";
import type { ClientRow, ClientView } from "@/lib/types";

function toView(row: ClientRow): ClientView {
  return {
    id: row.id,
    name: row.name,
    goal: row.goal ?? "—",
    lastSession: "—", // wired in M6 (Strava ingest)
    strava: !!row.strava_athlete_id,
    status: row.status,
    aftLevel: row.aft_level ?? null,
  };
}

export default async function DashboardPage() {
  const supabase = await supabaseServer();
  const locale = await getLocale();
  const t = await getT();

  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [clientsResp, recentActivityResp, openInjuriesResp, invitesResp, programsResp, exercisesResp, sessionsResp, requestsResp] = await Promise.all([
    supabase.from("clients")
      .select("id, trainer_id, name, goal, strava_athlete_id, status, created_at, aft_level")
      .order("created_at", { ascending: false })
      .returns<ClientRow[]>(),
    // Clients who have synced an activity in the last 7 days → everyone else has gone quiet.
    supabase.from("activities")
      .select("client_id")
      .gte("started_at", sevenDaysAgo),
    // Unresolved injuries needing a programming adjustment.
    supabase.from("client_injury_log")
      .select("client_id")
      .is("resolved_at", null),
    supabase.from("onboarding_invites")
      .select("client_id, token, expires_at, accepted_at, created_at, clients(name)")
      .or(`accepted_at.is.null,accepted_at.gte.${new Date(Date.now() - 7 * 86_400_000).toISOString()}`)
      .gt("expires_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(12),
    supabase.from("programs").select("id, client_id, week_start, plan").returns<ProgramRow[]>(),
    supabase.from("exercise_db").select("id, name, muscle_group").returns<ExerciseRow[]>(),
    supabase.from("sessions").select("id, client_id, scheduled_at, title, focus, exercises, feedback").returns<SessionRow[]>(),
    supabase.from("program_change_requests")
      .select("client_id")
      .eq("status", "pending"),
  ]);

  const clients: ClientView[] = (clientsResp.data ?? []).map(toView);

  // Resolve client names so each card can show *who* is behind the count.
  const clientNameById = new Map((clientsResp.data ?? []).map((c) => [c.id, c.name]));
  const namesFor = (ids: Iterable<string>): string[] =>
    [...new Set(ids)].map((id) => clientNameById.get(id)).filter((n): n is string => !!n);

  // Active roster — names for the avatar preview.
  const rosterNames = (clientsResp.data ?? []).map((c) => c.name);

  // Quiet clients: connected to Strava but no synced activity in the last 7 days.
  const recentlyActive = new Set((recentActivityResp.data ?? []).map((a) => (a as { client_id: string }).client_id));
  // "Resting" clients are intentionally off — don't flag them as quiet.
  const quietClientRows = (clientsResp.data ?? []).filter(
    (c) => c.strava_athlete_id && c.status !== "Resting" && !recentlyActive.has(c.id),
  );
  const quietNames = quietClientRows.map((c) => c.name);
  const quietClients = quietClientRows.length;

  // Open injuries: distinct clients with an unresolved injury-log entry.
  const injuryNames = namesFor((openInjuriesResp.data ?? []).map((r) => (r as { client_id: string }).client_id));
  const openInjuries = injuryNames.length;

  // Pending change requests awaiting trainer approval (distinct clients).
  const requestClientIds = new Set((requestsResp.data ?? []).map((r) => (r as { client_id: string }).client_id));
  const requestNames = namesFor(requestClientIds);
  const pendingRequests = requestClientIds.size;
  const pendingInvites = (invitesResp.data ?? []).map((row) => {
    const r = row as {
      client_id: string;
      token: string;
      expires_at: string;
      accepted_at: string | null;
      clients: { name: string } | { name: string }[] | null;
    };
    const clientName = Array.isArray(r.clients) ? r.clients[0]?.name : r.clients?.name;
    return {
      client_id: r.client_id,
      client_name: clientName ?? "Unnamed client",
      token: r.token,
      expires_at: r.expires_at,
      accepted_at: r.accepted_at,
    };
  });

  const clientsLite = (clientsResp.data ?? []).map((c) => ({ id: c.id, name: c.name }));
  const sessions = [
    ...buildSessions(programsResp.data ?? [], clientsLite, exercisesResp.data ?? []),
    ...sessionsToCalendar(sessionsResp.data ?? [], clientsLite, exercisesResp.data ?? []),
  ];
  const todayIso = new Date().toISOString().slice(0, 10);

  // Accent colours matching each card's tint, for the avatar stacks.
  const accents = { moss: "#b0d4a0", ochre: "#e4c08c", terracotta: "#e89878", sage: "#bcd3b8" };
  // Shown in the bottom-right of an alert card when there's nothing to action.
  const allClear = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        borderRadius: "50%",
        background: "rgba(255,252,245,0.06)",
        border: "1px solid rgba(255,252,245,0.12)",
        color: "rgba(244,237,226,0.4)",
      }}
    >
      <CheckIcon />
    </span>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: "22px 28px",
        overflowY: "auto",
        flex: 1,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        <MetricCard
          tint="moss"
          icon={<ClientsIcon />}
          number={clients.length}
          label={t("metric.activeClients")}
          sub={`${clients.length} ${t("metric.onRoster")}`}
          graphic={<AvatarStack names={rosterNames} accent={accents.moss} title={t("metric.activeClients")} />}
        />

        <MetricCard
          tint="ochre"
          icon={<ClockIcon />}
          number={quietClients}
          label={t("metric.quietClients")}
          sub={quietClients > 0 ? t("metric.quietClientsSub") : t("metric.allCheckedIn")}
          alert={quietClients > 0}
          graphic={<AvatarStack names={quietNames} accent={accents.ochre} empty={allClear} title={t("metric.quietClients")} />}
        />

        <MetricCard
          tint="terracotta"
          icon={<HeartPulseIcon />}
          number={openInjuries}
          label={t("metric.openInjuries")}
          sub={openInjuries > 0 ? t("metric.openInjuriesSub") : t("metric.noInjuries")}
          alert={openInjuries > 0}
          graphic={<AvatarStack names={injuryNames} accent={accents.terracotta} empty={allClear} title={t("metric.openInjuries")} />}
        />

        <MetricCard
          tint="sage"
          icon={<BellIcon />}
          number={pendingRequests}
          label={t("request.trainerTitle")}
          sub={pendingRequests > 0 ? t("metric.requestsSub") : t("metric.noRequests")}
          alert={pendingRequests > 0}
          graphic={<AvatarStack names={requestNames} accent={accents.sage} empty={allClear} title={t("request.trainerTitle")} />}
        />
      </div>

      <PendingInvitesStrip invites={pendingInvites} locale={locale} />

      <SessionCalendar sessions={sessions} locale={locale} todayIso={todayIso} />

      <ScheduledAgents clients={clientsLite} />
    </div>
  );
}
