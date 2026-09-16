// Next-run computation for scheduled agent activities.
//
// Schedules are expressed in the trainer's LOCAL wall-clock time. We store a
// fixed UTC offset (browser getTimezoneOffset(), where UTC = local + offset)
// captured when the schedule is saved, and convert to a real UTC instant here.
// DST transitions aren't tracked — fine for an internal trainer tool.

export type Frequency = "daily" | "weekly";

export type ScheduleSpec = {
  frequency: Frequency;
  hour: number;          // 0–23, local
  minute: number;        // 0–59, local
  weekday: number | null; // 0=Sun .. 6=Sat, local — required for weekly
  tzOffsetMinutes: number;
};

// First firing strictly after `from`. Searches up to two weeks ahead, which
// always covers daily/weekly cadences.
export function computeNextRun(spec: ScheduleSpec, from: Date = new Date()): Date {
  const { frequency, hour, minute, weekday, tzOffsetMinutes } = spec;
  const off = tzOffsetMinutes * 60_000;

  // `from` rendered as local wall-clock fields (held in a Date's UTC getters).
  const localFrom = new Date(from.getTime() - off);

  for (let i = 0; i <= 14; i++) {
    const day = new Date(localFrom.getTime() + i * 86_400_000);
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth();
    const d = day.getUTCDate();

    if (frequency === "weekly" && weekday != null && day.getUTCDay() !== weekday) continue;

    // Local wall-clock target → real UTC instant (UTC = local + offset).
    const candidate = new Date(Date.UTC(y, m, d, hour, minute) + off);
    if (candidate.getTime() > from.getTime()) return candidate;
  }

  // Unreachable for daily/weekly, but keep the contract total.
  return new Date(from.getTime() + 86_400_000);
}
