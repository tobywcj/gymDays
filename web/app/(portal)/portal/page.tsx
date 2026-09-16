import { redirect } from "next/navigation";
import { T } from "@/lib/design-tokens";
import { supabaseServer } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth/viewer";
import { getLocale, getT } from "@/lib/i18n-server";
import { relativeTime } from "@/lib/relative-time";
import { buildSessions, sessionsToCalendar, type ProgramRow, type ExerciseRow, type CalendarSession, type SessionRow } from "@/lib/sessions";
import type { Locale } from "@/lib/i18n";
import PortalInjuryCard from "@/components/portal/PortalInjuryCard";
import ProgramRequestForm from "@/components/portal/ProgramRequestForm";
import PortalProgressCard from "@/components/portal/PortalProgressCard";
import StravaActivityChart from "@/components/dashboard/StravaActivityChart";
import MarkdownSummary from "@/components/dashboard/MarkdownSummary";

type WorkoutRow = { id: string; performed_at: string; rpe: number | null; notes: string | null };
type ActivityRow = { id: string; type: string | null; started_at: string; distance_m: number | null; duration_s: number | null; metrics: Record<string, unknown> | null };
type ReportRow = { id: string; period_start: string; period_end: string; summary: string | null; created_at: string | null };

// Most portal cards share one fixed height so the grid reads as a uniform wall of
// tiles; content that overflows scrolls inside the card. The full-width activity
// trend chart is the exception — it grows with its content.
const CARD_H = 340;

function Card({ title, children, highlight }: { title: string; children: React.ReactNode; highlight?: boolean }) {
  return (
    <section
      className={highlight ? "glass glass-tint-ochre" : "glass"}
      style={{ borderRadius: T.radius.card, padding: 20, height: CARD_H, display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em", marginBottom: 12, flexShrink: 0 }}>{title}</div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 12, color: T.muted }}>{text}</div>;
}

// Days between two "YYYY-MM-DD" strings (UTC, matches buildSessions anchoring).
function daysUntil(todayIso: string, dateIso: string): number {
  const a = Date.parse(todayIso + "T00:00:00Z");
  const b = Date.parse(dateIso + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

function formatDate(dateIso: string, locale: Locale): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-Hant" : "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

// An emoji that matches the Strava activity type.
function activityEmoji(type: string | null): string {
  const s = (type || "").toLowerCase();
  if (s.includes("run")) return "🏃";
  if (s.includes("ride") || s.includes("cycl") || s.includes("bike")) return "🚴";
  if (s.includes("swim")) return "🏊";
  if (s.includes("walk")) return "🚶";
  if (s.includes("hik")) return "🥾";
  if (s.includes("row")) return "🚣";
  if (s.includes("yoga")) return "🧘";
  if (s.includes("weight") || s.includes("strength") || s.includes("workout")) return "💪";
  return "🏅";
}

function ExerciseList({ session, t }: { session: CalendarSession; t: (k: string) => string }) {
  return (
    <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
      {session.exercises.map((e, j) => (
        <li key={j} style={{ fontSize: 12, color: T.mutedMid, display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>{e.name ?? "—"}</span>
          <span style={{ color: T.muted, whiteSpace: "nowrap" }}>
            {e.sets} {t("portal.sets")} × {e.reps} {t("portal.reps")}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function PortalHome() {
  const viewer = await getViewer();
  if (viewer.role !== "client") redirect("/");
  const clientIds = viewer.clientIds;

  const supabase = await supabaseServer();
  const locale = await getLocale();
  const t = await getT();

  const [clientsResp, programsResp, workoutsResp, activitiesResp, reportResp, sessionsResp, injuryResp, mealPlanResp] = await Promise.all([
    supabase.from("clients").select("id, name, goal, injury_history, strava_athlete_id").in("id", clientIds).returns<{ id: string; name: string; goal: string | null; injury_history: string | null; strava_athlete_id: string | null }[]>(),
    supabase.from("programs").select("id, client_id, week_start, plan").in("client_id", clientIds).order("week_start", { ascending: false }).limit(6).returns<ProgramRow[]>(),
    supabase.from("workouts").select("id, performed_at, rpe, notes").in("client_id", clientIds).order("performed_at", { ascending: false }).limit(8).returns<WorkoutRow[]>(),
    supabase.from("activities").select("id, type, started_at, distance_m, duration_s, metrics").in("client_id", clientIds).order("started_at", { ascending: false }).limit(200).returns<ActivityRow[]>(),
    supabase.from("progress_reports").select("id, period_start, period_end, summary, created_at").in("client_id", clientIds).order("created_at", { ascending: false }).limit(1).maybeSingle<ReportRow>(),
    supabase.from("sessions").select("id, client_id, scheduled_at, title, focus, exercises").in("client_id", clientIds).order("scheduled_at", { ascending: false }).limit(30).returns<SessionRow[]>(),
    supabase.from("client_injury_log").select("note, source, created_at, resolved_at").in("client_id", clientIds).order("created_at", { ascending: false }).limit(12).returns<{ note: string | null; source: string; created_at: string; resolved_at: string | null }[]>(),
    supabase.from("meal_plans").select("week_start, plan").in("client_id", clientIds).order("week_start", { ascending: false }).limit(1).maybeSingle<{ week_start: string; plan: { type?: string; advice?: string } | null }>(),
  ]);

  const programs = programsResp.data ?? [];
  const clientsLite = (clientsResp.data ?? []).map((c) => ({ id: c.id, name: c.name }));

  // Resolve exercise names referenced anywhere in the fetched programmes + sessions.
  const referencedIds = Array.from(new Set([
    ...programs.flatMap((p) => (p.plan?.days ?? []).flatMap((d) => (d.exercises ?? []).map((e) => e.exercise_id).filter(Boolean) as string[])),
    ...(sessionsResp.data ?? []).flatMap((s) => (s.exercises ?? []).map((e) => e.exercise_id).filter(Boolean) as string[]),
  ]));
  let exercises: ExerciseRow[] = [];
  if (referencedIds.length > 0) {
    const { data } = await supabase.from("exercise_db").select("id, name, muscle_group").in("id", referencedIds).returns<ExerciseRow[]>();
    exercises = data ?? [];
  }

  const sessions = [
    ...buildSessions(programs, clientsLite, exercises),
    ...sessionsToCalendar(sessionsResp.data ?? [], clientsLite, exercises),
  ];
  const todayIso = new Date().toISOString().slice(0, 10);

  // The next session on or after today; if there is none, fall back to the
  // most recent past session so the card is never empty when a plan exists.
  const byDateAsc = [...sessions].sort((a, b) => (a.date < b.date ? -1 : 1));
  const upcoming =
    byDateAsc.find((s) => s.date >= todayIso) ??
    byDateAsc.filter((s) => s.date < todayIso).at(-1) ??
    null;
  const upcomingIsPast = !!upcoming && upcoming.date < todayIso;

  // This week's plan = the most recent programme's days, in date order.
  const latestWeek = programs[0]?.week_start;
  const weekSessions = sessions
    .filter((s) => s.weekStart === latestWeek)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const workouts = workoutsResp.data ?? [];
  const activities = activitiesResp.data ?? [];
  const report = reportResp.data;
  const goal = (clientsResp.data ?? [])[0]?.goal;
  const injuryStatus = (clientsResp.data ?? [])[0]?.injury_history ?? null;
  const injuryRecent = (injuryResp.data ?? []);
  const nutritionAdvice = mealPlanResp.data?.plan?.advice ?? null;
  const nutritionWeek = mealPlanResp.data?.week_start ?? null;

  // Activity-trend card (mirrors the coach dashboard), scoped to the first
  // client. Client-side controls only — sync, backfill HR, disconnect and
  // delete their own data; creating the connect invite is trainer-only.
  // The portal client can't read integration_tokens (RLS scopes it to the
  // trainer), so we use strava_athlete_id on the clients row as the connection
  // signal — it's set on connect and cleared on disconnect.
  const stravaAthleteId = (clientsResp.data ?? [])[0]?.strava_athlete_id ?? null;
  const stravaConnected = !!stravaAthleteId;
  const stravaConfigured = !!process.env.STRAVA_CLIENT_ID;
  const clientName = clientsLite[0]?.name ?? "";

  function whenLabel(dateIso: string): string {
    const d = daysUntil(todayIso, dateIso);
    if (d === 0) return t("portal.today");
    if (d === 1) return t("portal.tomorrow");
    if (d > 1) return t("portal.inDays").replace("{n}", String(d));
    if (d === -1) return t("portal.yesterday");
    return t("portal.daysAgo").replace("{n}", String(-d));
  }

  return (
    <>
      {goal && (
        <div style={{ fontSize: 12, color: T.mutedMid }}>
          <span style={{ color: T.muted }}>{t("portal.goal")}:</span> {goal}
        </div>
      )}

      <a href="/portal/insights" className="glass glass-tint-ochre" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        borderRadius: T.radius.card, padding: 18, textDecoration: "none", color: T.text,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em" }}>🧠 {t("insight.title")}</div>
          <div style={{ fontSize: 12, color: T.mutedMid, marginTop: 2 }}>{t("insight.subtitle")}</div>
        </div>
        <span style={{ fontSize: 18, color: T.accent }}>›</span>
      </a>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, 360px)",
        gap: 16,
        justifyContent: "center",
        alignItems: "start",
      }}>
      <Card title={upcomingIsPast ? t("portal.lastSession") : t("portal.upcoming")} highlight={!upcomingIsPast}>
        {!upcoming ? (
          <Empty text={t("portal.noUpcoming")} />
        ) : (
          <div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>
                {upcoming.dayLabel || formatDate(upcoming.date, locale)}
                {upcoming.focus ? <span style={{ color: T.accent, fontWeight: 600 }}> · {upcoming.focus}</span> : null}
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: upcomingIsPast ? T.mutedMid : "#e4c08c",
                  background: upcomingIsPast ? "rgba(244,237,226,0.06)" : "rgba(196,148,82,0.18)",
                  border: `1px solid ${T.border}`,
                  borderRadius: T.radius.pill,
                  padding: "3px 10px",
                  whiteSpace: "nowrap",
                }}
              >
                {whenLabel(upcoming.date)}
              </span>
            </div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{formatDate(upcoming.date, locale)}</div>
            {upcoming.exercises.length > 0 && <ExerciseList session={upcoming} t={t} />}
          </div>
        )}
      </Card>

      <Card title={t("portal.thisWeek")}>
        {weekSessions.length === 0 ? (
          <Empty text={t("portal.noProgram")} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {weekSessions.map((s) => (
              <div key={s.id}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.accent }}>
                  {s.dayLabel}{s.focus ? ` · ${s.focus}` : ""}
                </div>
                <ExerciseList session={s} t={t} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={t("portal.recentWorkouts")}>
        {workouts.length === 0 ? (
          <Empty text={t("portal.noWorkouts")} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {workouts.map((w) => (
              <div key={w.id} style={{ fontSize: 12, color: T.mutedMid, display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>{w.notes || "—"}</span>
                <span style={{ color: T.muted, whiteSpace: "nowrap" }}>
                  {w.rpe != null ? `${t("portal.rpe")} ${w.rpe} · ` : ""}{relativeTime(locale, w.performed_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={t("portal.recentActivity")}>
        {activities.length === 0 ? (
          <Empty text={t("portal.noActivity")} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 240, overflowY: "auto", paddingRight: 4 }}>
            {activities.map((a) => {
              const km = a.distance_m ? (a.distance_m / 1000).toFixed(1) + " km" : null;
              const min = a.duration_s ? Math.round(a.duration_s / 60) + " min" : null;
              const meta = [km, min].filter(Boolean).join(" · ");
              // Relative ("2 days ago") within the past week; switch to an actual date after 7 days.
              const dateIso = a.started_at.slice(0, 10);
              const daysAgo = -daysUntil(todayIso, dateIso);
              const when = daysAgo > 7 ? formatDate(dateIso, locale) : relativeTime(locale, a.started_at);
              return (
                <div key={a.id} style={{ fontSize: 12, color: T.mutedMid, display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {activityEmoji(a.type)} {a.type || "Activity"}{meta ? ` · ${meta}` : ""}
                  </span>
                  <span style={{ color: T.muted, whiteSpace: "nowrap" }}>{when}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div style={{ gridColumn: "1 / -1", minHeight: 0 }}>
        <StravaActivityChart
          activities={activities}
          clientId={clientIds[0]}
          clientName={clientName}
          connected={stravaConnected}
          athleteId={stravaAthleteId}
          stravaConfigured={stravaConfigured}
          goal={goal ?? null}
          portal
        />
      </div>

      <div style={{ gridColumn: "span 2" }}>
        <PortalProgressCard clientId={clientIds[0]} report={report ?? null} />
      </div>

      <div style={{ gridColumn: "1 / -1", minHeight: 0 }}>
        <Card title={t("portal.nutrition")}>
          {nutritionAdvice ? (
            <div>
              {nutritionWeek && (
                <div style={{ fontSize: 11, color: T.muted, marginBottom: 8 }}>
                  {t("panel.weekOf")} <strong style={{ color: T.mutedMid }}>{nutritionWeek}</strong>
                </div>
              )}
              <MarkdownSummary text={nutritionAdvice} />
            </div>
          ) : (
            <Empty text={t("portal.noNutrition")} />
          )}
        </Card>
      </div>

      <div style={{ height: CARD_H }}>
        <ProgramRequestForm />
      </div>

      <div style={{ gridColumn: "span 3", height: CARD_H }}>
        <PortalInjuryCard official={injuryStatus} entries={injuryRecent} />
      </div>
      </div>
    </>
  );
}
