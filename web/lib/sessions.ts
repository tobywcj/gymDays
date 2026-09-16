// Derives trainer-level "sessions" from weekly program rows. There is no
// sessions table — each program covers a week (`week_start`) of `plan.days[]`,
// so we anchor day N to `week_start + N days` to land it on a real calendar date.

export type CalendarExercise = {
  name: string | null;
  muscleGroup: string | null;
  sets: number | string;
  reps: number | string;
  notes: string;
};

export type CalendarSession = {
  id: string;
  clientId: string;
  clientName: string;
  color: string;
  date: string;      // "YYYY-MM-DD"
  weekStart: string; // "YYYY-MM-DD"
  dayLabel: string;
  focus: string;
  exercises: CalendarExercise[];
  // Only set for real `sessions` rows (the trainer can leave feedback on these);
  // null for sessions derived from a weekly program.
  sessionId?: string | null;
  feedback?: string | null;
};

type PlanExercise = { exercise_id: string; sets: number | string; reps: number | string; notes?: string };
type PlanDay = { day: string; focus: string; exercises: PlanExercise[] };
type Plan = { days?: PlanDay[] };

export type ProgramRow = { id: string; client_id: string; week_start: string; plan: Plan | null };
export type ClientLite = { id: string; name: string };
export type ExerciseRow = { id: string; name: string; muscle_group: string | null };

// Eight distinct, on-palette client colours; assigned by stable roster index.
export const CLIENT_COLORS = [
  "#c4946a", // accent ochre
  "#86a378", // moss
  "#c46c4c", // terracotta
  "#7a948c", // blue-sage
  "#c49452", // ochre-deep
  "#8ca48c", // sage
  "#b07a5a", // clay
  "#6e8f86", // teal
];

// Add `days` to a "YYYY-MM-DD" string, returning a new "YYYY-MM-DD".
// Uses UTC so it is immune to DST / local-offset drift.
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// Explicit, trainer-scheduled sessions from the `sessions` table. Merged into
// the same CalendarSession[] the calendars render, so the shared row syncs the
// trainer's SessionCalendar and the client's portal calendar.
type SessionExercise = { exercise_id: string; sets?: number | string; reps?: number | string; notes?: string; order?: number };
export type SessionRow = {
  id: string;
  client_id: string;
  scheduled_at: string;  // ISO timestamptz
  title: string | null;
  focus: string | null;
  exercises: SessionExercise[] | null;
  feedback: string | null;
};

export function sessionsToCalendar(
  rows: SessionRow[],
  clients: ClientLite[],
  exercises: ExerciseRow[],
): CalendarSession[] {
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const clientColor = new Map(clients.map((c, i) => [c.id, CLIENT_COLORS[i % CLIENT_COLORS.length]]));
  const exMap = new Map(exercises.map((e) => [e.id, e]));

  return rows.map((s) => {
    const list = [...(s.exercises ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const date = s.scheduled_at.slice(0, 10);
    return {
      id: `session-${s.id}`,
      sessionId: s.id,
      feedback: s.feedback ?? null,
      clientId: s.client_id,
      clientName: clientName.get(s.client_id) ?? "—",
      color: clientColor.get(s.client_id) ?? CLIENT_COLORS[0],
      date,
      weekStart: date,
      dayLabel: s.title ?? "",
      focus: s.focus ?? s.title ?? "",
      exercises: list.map((ex) => {
        const lk = exMap.get(ex.exercise_id);
        return {
          name: lk?.name ?? null,
          muscleGroup: lk?.muscle_group ?? null,
          sets: ex.sets ?? "",
          reps: ex.reps ?? "",
          notes: ex.notes ?? "",
        };
      }),
    };
  });
}

export function buildSessions(
  programs: ProgramRow[],
  clients: ClientLite[],
  exercises: ExerciseRow[],
): CalendarSession[] {
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const clientColor = new Map(clients.map((c, i) => [c.id, CLIENT_COLORS[i % CLIENT_COLORS.length]]));
  const exMap = new Map(exercises.map((e) => [e.id, e]));

  const sessions: CalendarSession[] = [];
  for (const prog of programs) {
    const days = prog.plan?.days ?? [];
    days.forEach((day, i) => {
      const exList = (day.exercises ?? []).map((ex) => {
        const lk = exMap.get(ex.exercise_id);
        return {
          name: lk?.name ?? null,
          muscleGroup: lk?.muscle_group ?? null,
          sets: ex.sets ?? "",
          reps: ex.reps ?? "",
          notes: ex.notes ?? "",
        };
      });
      sessions.push({
        id: `${prog.id}-${i}`,
        sessionId: null,
        feedback: null,
        clientId: prog.client_id,
        clientName: clientName.get(prog.client_id) ?? "—",
        color: clientColor.get(prog.client_id) ?? CLIENT_COLORS[0],
        date: addDays(prog.week_start, i),
        weekStart: prog.week_start,
        dayLabel: day.day ?? "",
        focus: day.focus ?? "",
        exercises: exList,
      });
    });
  }
  return sessions;
}
