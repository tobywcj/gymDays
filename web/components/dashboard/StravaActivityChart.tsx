"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { T } from "@/lib/design-tokens";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n-context";
import StravaLogo from "./StravaLogo";
import StravaInviteButton from "./StravaInviteButton";
import StravaDeleteDataButton from "./StravaDeleteDataButton";
import PoweredByStrava from "@/components/strava/PoweredByStrava";
import Spinner from "./Spinner";

const RANGES = [
  { label: "1W",  weeks: 1  },
  { label: "2W",  weeks: 2  },
  { label: "4W",  weeks: 4  },
  { label: "8W",  weeks: 8  },
  { label: "3M",  weeks: 13 },
  { label: "6M",  weeks: 26 },
] as const;
type RangeLabel = typeof RANGES[number]["label"];

type Activity = {
  id: string;
  started_at: string;
  distance_m: number | null;
  duration_s: number | null;
  type: string | null;
  metrics: Record<string, unknown> | null;
};

type HrZones = { z1: number; z2: number; z3: number; z4: number; z5: number };

type WeekRow = {
  label: string;
  sessions: number;
  km: number;
  hrs: number;
  avgHr: number | null;
  maxHr: number | null;
  elevM: number;
  sufferScore: number;
  kcal: number;
  types: Record<string, number>;
  zones: HrZones;
  items: Activity[];
};

type Props = {
  activities: Activity[];
  clientId: string;
  clientName: string;
  connected: boolean;
  athleteId: string | null;
  stravaConfigured: boolean;
  goal: string | null;
  // Client-portal mode: the client may sync, backfill HR, disconnect and delete
  // their own data, but inviting/connecting is trainer-only — so the invite and
  // dev-seed actions are hidden, and the disconnect tip reminds them to ask the
  // trainer for a fresh connect link.
  portal?: boolean;
};

function buildWeekly(activities: Activity[], weeks: number): WeekRow[] {
  const now = new Date();
  const todayDow = (now.getDay() + 6) % 7; // 0=Mon
  return Array.from({ length: weeks }, (_, i) => {
    const monday = new Date(now);
    monday.setDate(now.getDate() - todayDow - (weeks - 1 - i) * 7);
    monday.setHours(0, 0, 0, 0);
    const next = new Date(monday);
    next.setDate(monday.getDate() + 7);

    const week = activities.filter((a) => {
      const d = new Date(a.started_at);
      return d >= monday && d < next;
    });

    const hrArr = week
      .map((a) => a.metrics?.average_heartrate as number | undefined)
      .filter((v): v is number => typeof v === "number" && v > 0);
    const maxHrArr = week
      .map((a) => a.metrics?.max_heartrate as number | undefined)
      .filter((v): v is number => typeof v === "number" && v > 0);

    return {
      label:       monday.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      sessions:    week.length,
      km:          Math.round(week.reduce((s, a) => s + (a.distance_m ?? 0), 0) / 100) / 10,
      hrs:         Math.round(week.reduce((s, a) => s + (a.duration_s ?? 0), 0) / 360) / 10,
      avgHr:       hrArr.length > 0 ? Math.round(hrArr.reduce((s, v) => s + v, 0) / hrArr.length) : null,
      maxHr:       maxHrArr.length > 0 ? Math.max(...maxHrArr) : null,
      elevM:       Math.round(week.reduce((s, a) => s + ((a.metrics?.total_elevation_gain as number) ?? 0), 0)),
      sufferScore: Math.round(week.reduce((s, a) => s + ((a.metrics?.suffer_score as number) ?? 0), 0)),
      kcal:        Math.round(week.reduce((s, a) => s + ((a.metrics?.calories as number) ?? 0), 0)),
      types:       week.reduce<Record<string, number>>((acc, a) => {
        const t = a.type ?? "Unknown";
        acc[t] = (acc[t] ?? 0) + 1;
        return acc;
      }, {}),
      zones: week.reduce<HrZones>((acc, a) => {
        const z = (a.metrics?.hr_zones ?? {}) as Partial<HrZones>;
        return {
          z1: acc.z1 + (z.z1 ?? 0),
          z2: acc.z2 + (z.z2 ?? 0),
          z3: acc.z3 + (z.z3 ?? 0),
          z4: acc.z4 + (z.z4 ?? 0),
          z5: acc.z5 + (z.z5 ?? 0),
        };
      }, { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }),
      items: week.slice().sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()),
    };
  });
}

const ZONE_COLORS = ["#6ab0f5", "#86a378", "#e4c08c", "#f4a260", "#f47a7a"] as const;
const ZONE_KEYS = ["zone.z1", "zone.z2", "zone.z3", "zone.z4", "zone.z5"] as const;

type TFn = (key: string) => string;

function fmtZoneTime(s: number): string {
  if (s === 0) return "0 m";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function aggregateZones(items: Activity[]): HrZones {
  return items.reduce<HrZones>((acc, a) => {
    const z = (a.metrics?.hr_zones ?? {}) as Partial<HrZones>;
    return {
      z1: acc.z1 + (z.z1 ?? 0), z2: acc.z2 + (z.z2 ?? 0),
      z3: acc.z3 + (z.z3 ?? 0), z4: acc.z4 + (z.z4 ?? 0), z5: acc.z5 + (z.z5 ?? 0),
    };
  }, { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 });
}

function classifyLoad(easyPct: number, modPct: number, hardPct: number) {
  if (easyPct >= 75 && hardPct >= 10) return { labelKey: "sa.lc.polar",  tone: "#86a378", noteKey: "sa.lc.polarNote" };
  if (easyPct >= 85)                  return { labelKey: "sa.lc.easy",   tone: "#6ab0f5", noteKey: "sa.lc.easyNote" };
  if (modPct >= 30)                   return { labelKey: "sa.lc.thresh", tone: "#f4a260", noteKey: "sa.lc.threshNote" };
  if (hardPct >= 25)                  return { labelKey: "sa.lc.hard",   tone: "#f47a7a", noteKey: "sa.lc.hardNote" };
  return { labelKey: "sa.lc.mixed", tone: "#bcd3b8", noteKey: "sa.lc.mixedNote" };
}

function consistencyStats(items: Activity[], weeks: number) {
  const now = new Date();
  const since = new Date(now); since.setDate(now.getDate() - weeks * 7); since.setHours(0, 0, 0, 0);

  const dayBuckets = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun count
  const activeDays = new Set<string>();
  for (const a of items) {
    const d = new Date(a.started_at);
    if (d < since) continue;
    dayBuckets[(d.getDay() + 6) % 7]++;
    activeDays.add(d.toDateString());
  }

  let longestStreak = 0, current = 0;
  for (const d = new Date(since); d <= now; d.setDate(d.getDate() + 1)) {
    if (activeDays.has(d.toDateString())) { current++; longestStreak = Math.max(longestStreak, current); }
    else current = 0;
  }

  let daysSinceLast = -1;
  if (items.length > 0) {
    const latest = items.reduce((max, a) => Math.max(max, new Date(a.started_at).getTime()), 0);
    daysSinceLast = Math.floor((now.getTime() - latest) / 86_400_000);
  }

  return { dayBuckets, sessionsPerWeek: items.length / weeks, longestStreak, daysSinceLast };
}

function generateInsights(data: WeekRow[], items: Activity[], stats: ReturnType<typeof consistencyStats>): string[] {
  const out: string[] = [];

  if (stats.longestStreak >= 5) out.push(`🔥 ${stats.longestStreak}-day training streak`);
  if (stats.daysSinceLast >= 4) out.push(`⏸ ${stats.daysSinceLast} days since last workout — consider checking in`);

  if (data.length >= 4) {
    const half = Math.floor(data.length / 2);
    const earlyZ2 = data.slice(0, half).reduce((s, w) => s + w.zones.z2, 0);
    const lateZ2  = data.slice(half).reduce((s, w) => s + w.zones.z2, 0);
    if (earlyZ2 > 0 && lateZ2 > earlyZ2 * 1.15) {
      out.push(`📈 Z2 volume up ${Math.round((lateZ2 / earlyZ2 - 1) * 100)}% — aerobic base building`);
    } else if (lateZ2 > 0 && earlyZ2 > lateZ2 * 1.15) {
      out.push(`📉 Z2 volume down ${Math.round((earlyZ2 / lateZ2 - 1) * 100)}% — easy work tapering`);
    }

    const recent2 = data.slice(-2).reduce((s, w) => s + w.sufferScore, 0) / 2;
    const base = data.slice(0, -2).reduce((s, w) => s + w.sufferScore, 0) / Math.max(1, data.length - 2);
    if (base > 0 && recent2 > base * 1.5) {
      out.push(`⚠ Load spike: last 2 weeks ${Math.round((recent2 / base - 1) * 100)}% above baseline`);
    }
  }

  const heaviest = data.reduce<WeekRow | null>((best, w) => (best === null || w.sufferScore > best.sufferScore) ? w : best, null);
  if (heaviest && heaviest.sufferScore > 0) {
    out.push(`💥 Heaviest week: ${heaviest.label} · ${heaviest.sessions} sessions · ${heaviest.sufferScore} suffer`);
  }

  const longest = items.reduce<Activity | null>((best, a) => (best === null || (a.duration_s ?? 0) > (best.duration_s ?? 0)) ? a : best, null);
  if (longest && (longest.duration_s ?? 0) >= 1800) {
    const dur = longest.duration_s ?? 0;
    const h = Math.floor(dur / 3600), m = Math.floor((dur % 3600) / 60);
    const dl = new Date(longest.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    out.push(`🏆 Longest session: ${h}h ${m}m ${longest.type ?? ""} on ${dl}`);
  }

  return out.slice(0, 5);
}

function goalStats(allActivities: Activity[]) {
  if (allActivities.length === 0) return null;
  const first = allActivities.reduce((min, a) => Math.min(min, new Date(a.started_at).getTime()), Date.now());
  const weeksTraining = Math.max(1, Math.round((Date.now() - first) / (7 * 86_400_000)));
  const typeCount = allActivities.reduce<Record<string, number>>((acc, a) => {
    const t = a.type ?? "Unknown"; acc[t] = (acc[t] ?? 0) + 1; return acc;
  }, {});
  const top = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0];
  return {
    weeksTraining,
    totalSessions: allActivities.length,
    sessionsPerWeek: allActivities.length / weeksTraining,
    topType: top?.[0] ?? null,
    topTypePct: top ? Math.round((top[1] / allActivities.length) * 100) : 0,
  };
}

function PanelHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, color: T.muted,
      textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

function fmtDuration(s: number): string {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function WorkoutRow({ a }: { a: Activity }) {
  const { t } = useI18n();
  const d = new Date(a.started_at);
  const dateLabel = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const m = a.metrics ?? {};
  const km = a.distance_m ? Math.round(a.distance_m / 100) / 10 : null;
  const avgHr = m.average_heartrate as number | undefined;
  const maxHr = m.max_heartrate as number | undefined;
  const suffer = m.suffer_score as number | undefined;
  const kcal = m.calories as number | undefined;
  const elev = m.total_elevation_gain as number | undefined;
  const zones = m.hr_zones as Partial<HrZones> | undefined;
  const zoneValues = zones ? [zones.z1 ?? 0, zones.z2 ?? 0, zones.z3 ?? 0, zones.z4 ?? 0, zones.z5 ?? 0] : [];
  const zoneTotal = zoneValues.reduce((s, v) => s + v, 0);

  const cells: Array<{ label: string; value: string; color: string }> = [
    { label: t("sa.cDist"),   value: km ? `${km} km` : "—",                  color: "#86a378" },
    { label: t("sa.cDur"),    value: fmtDuration(a.duration_s ?? 0),         color: "#bcd3b8" },
    { label: t("sa.cAvgHr"),  value: avgHr ? `${avgHr}` : "—",               color: "#f4a7a7" },
    { label: t("sa.cMaxHr"),  value: maxHr ? `${maxHr}` : "—",               color: "#f47a7a" },
    { label: t("sa.cElev"),   value: elev ? `${Math.round(elev)} m` : "—",   color: "#a8c4e0" },
    { label: t("sa.cSuffer"), value: suffer ? String(Math.round(suffer)) : "—", color: "#c9b1e8" },
    { label: t("sa.cKcal"),   value: kcal ? String(Math.round(kcal)) : "—",  color: "#f0c98a" },
  ];

  return (
    <div style={{
      padding: "8px 10px", borderRadius: 6,
      background: "rgba(255,255,255,0.02)", border: `1px solid ${T.border}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: T.mutedMid }}>{dateLabel}</span>
          <span style={{
            fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 99,
            background: "rgba(255,252,245,0.06)", border: `1px solid ${T.border}`,
            color: "rgba(244,237,226,0.6)", letterSpacing: "0.05em",
          }}>
            {a.type ?? "Unknown"}
          </span>
        </div>
        {typeof m.name === "string" && (
          <span style={{ fontSize: 10, color: "rgba(244,237,226,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
            {m.name as string}
          </span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((c) => (
          <div key={c.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: c.color }}>{c.value}</div>
            <div style={{ fontSize: 8, color: "rgba(244,237,226,0.35)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 1 }}>{c.label}</div>
          </div>
        ))}
      </div>
      {zoneTotal > 0 && (
        <div style={{ display: "flex", height: 4, borderRadius: 2, overflow: "hidden", marginTop: 6 }}>
          {zoneValues.map((v, i) => v > 0 && (
            <div key={i} style={{ flex: v, background: ZONE_COLORS[i] }} title={`${t(ZONE_KEYS[i])} ${fmtZoneTime(v)}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function WeekDetail({ row }: { row: WeekRow }) {
  const { t } = useI18n();
  const lines: Array<{ label: string; value: string; color: string }> = [
    { label: t("sa.distance"),     value: row.km > 0 ? `${row.km} km` : "—",                     color: "#86a378" },
    { label: t("sa.duration"),     value: row.hrs > 0 ? `${row.hrs} h` : "—",                    color: "#bcd3b8" },
    { label: t("sa.avgHr"),        value: row.avgHr ? `${row.avgHr} bpm` : "—",                  color: "#f4a7a7" },
    { label: t("sa.maxHr"),        value: row.maxHr ? `${row.maxHr} bpm` : "—",                  color: "#f47a7a" },
    { label: t("sa.elevation"),    value: row.elevM > 0 ? `${row.elevM} m` : "—",                color: "#a8c4e0" },
    { label: t("sa.sufferScore"),  value: row.sufferScore > 0 ? String(row.sufferScore) : "—",   color: "#c9b1e8" },
    { label: t("sa.calories"),     value: row.kcal > 0 ? `${row.kcal} kcal` : "—",              color: "#f0c98a" },
  ];

  const typeEntries = Object.entries(row.types).sort((a, b) => b[1] - a[1]);
  const zoneValues = [row.zones.z1, row.zones.z2, row.zones.z3, row.zones.z4, row.zones.z5];
  const zoneTotal = zoneValues.reduce((s, v) => s + v, 0);
  const hasZones = zoneTotal > 0;

  return (
    <div style={{
      borderTop: `1px solid ${T.border}`, paddingTop: 12, marginTop: 4,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: T.mutedMid }}>
          {t("panel.weekOf")} {row.label} · {row.sessions} {row.sessions === 1 ? t("sa.workout") : t("sa.workouts")}
        </span>
        {typeEntries.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {typeEntries.map(([t, count]) => (
              <span key={t} style={{
                fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 99,
                background: "rgba(255,252,245,0.06)", border: `1px solid ${T.border}`,
                color: "rgba(244,237,226,0.6)", letterSpacing: "0.05em",
              }}>
                {count}× {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Weekly aggregate */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px 12px" }}>
        {lines.map((l) => (
          <div key={l.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
            <span style={{ color: "rgba(244,237,226,0.4)" }}>{l.label}</span>
            <span style={{ color: l.color, fontWeight: 600 }}>{l.value}</span>
          </div>
        ))}
      </div>

      {hasZones && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 6 }}>
            {zoneValues.map((v, i) => v > 0 && (
              <div key={i} style={{ flex: v, background: ZONE_COLORS[i] }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {zoneValues.map((v, i) => v > 0 && (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: ZONE_COLORS[i], display: "inline-block" }} />
                <span style={{ color: ZONE_COLORS[i], fontWeight: 600 }}>
                  {t(ZONE_KEYS[i]).split(" ")[0]} {Math.round(v / zoneTotal * 100)}% · {fmtZoneTime(v)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-workout breakdown */}
      {row.items.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: T.muted,
            textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6,
          }}>
            {t("sa.workoutsThisWeek")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {row.items.map((a) => (
              <WorkoutRow key={a.id} a={a} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function StravaActivityChart({
  activities: initialActivities,
  clientId,
  clientName,
  connected,
  athleteId,
  stravaConfigured,
  goal,
  portal = false,
}: Props) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const zh = locale === "zh";
  const LEGEND = [
    { label: t("sa.legendSessions"), color: "#e4c08c" },
    { label: t("sa.legendDist"),     color: "#86a378" },
    { label: t("sa.legendDur"),      color: "#bcd3b8" },
    { label: t("sa.legendAvgHr"),    color: "#f4a7a7" },
  ];
  const [activities, setActivities] = useState<Activity[]>(initialActivities);
  const [range, setRange] = useState<RangeLabel>("8W");
  const [typeFilter, setTypeFilter] = useState<string>("All");
  const [hoveredWeek, setHoveredWeek] = useState<WeekRow | null>(null);

  type SyncStage = "idle" | "pulling" | "done" | "error";
  const [syncStage, setSyncStage] = useState<SyncStage>("idle");
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [justDisconnected, setJustDisconnected] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [modalMounted, setModalMounted] = useState(false);
  useEffect(() => { setModalMounted(true); }, []);

  // Track activities missing HR-stream data (suffer_score + hr_zones), so we
  // can show "X activities pending" status next to the Backfill HR data button.
  const [hrMissing, setHrMissing] = useState<number | null>(null);
  const [hrBackfillBusy, setHrBackfillBusy] = useState(false);
  const [hrBackfillMsg, setHrBackfillMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) {
      setHrMissing(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/strava/backfill-suffer/${clientId}`);
        if (!r.ok) return;
        const { missing } = (await r.json()) as { missing: number };
        if (!cancelled) setHrMissing(missing);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [clientId, connected, activities.length]);

  async function backfillHr() {
    setHrBackfillBusy(true);
    setHrBackfillMsg(zh ? "開始中…" : "Starting…");
    try {
      const r = await fetch(`/api/strava/backfill-suffer/${clientId}`, { method: "POST" });
      if (!r.ok || !r.body) throw new Error(`${r.status}: ${await r.text()}`);
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as
            | { processed: number; updated: number; total: number }
            | { done: true; updated: number; total: number; remaining: number }
            | { error: string };
          if ("error" in ev) throw new Error(ev.error);
          if ("done" in ev) {
            setHrMissing(ev.remaining);
            setHrBackfillMsg(
              ev.remaining > 0
                ? (zh
                    ? `已回補 ${ev.updated} 筆 · ${ev.remaining} 筆待處理（下個每小時週期）`
                    : `Backfilled ${ev.updated} · ${ev.remaining} pending (next hourly cycle)`)
                : (zh
                    ? `回補完成 · 已更新 ${ev.updated} 筆`
                    : `Backfill complete · ${ev.updated} updated`),
            );
          } else {
            setHrBackfillMsg(zh ? `擷取串流中… ${ev.processed} / ${ev.total}` : `Pulling streams… ${ev.processed} / ${ev.total}`);
          }
        }
      }
      router.refresh();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("not_connected")) {
        setHrBackfillMsg(zh ? "尚未連結 Strava。" : "Strava is not connected.");
      } else {
        setHrBackfillMsg(`${zh ? "回補失敗：" : "Backfill failed:"} ${msg}`);
      }
    } finally {
      setHrBackfillBusy(false);
    }
  }

  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`activities:${clientId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "activities", filter: `client_id=eq.${clientId}` },
        (payload) => {
          const row = payload.new as Activity;
          if (payload.eventType === "INSERT") {
            setActivities((prev) => [row, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setActivities((prev) => prev.map((a) => a.id === row.id ? row : a));
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clientId]);

  // Re-fetch activities directly from Supabase, so the chart updates immediately
  // after a sync regardless of whether Realtime delivered the events.
  async function refetchActivities() {
    const supabase = supabaseBrowser();
    const { data } = await supabase
      .from("activities")
      .select("id, started_at, distance_m, duration_s, type, metrics")
      .eq("client_id", clientId)
      .order("started_at", { ascending: false })
      .limit(500);
    if (data) setActivities(data as Activity[]);
  }

  // Single sync entry point. First sync (no local data) → stream full
  // historical pull. Otherwise → incremental pull since last activity.
  async function runSync() {
    const isFirstSync = activities.length === 0;
    setSyncStage("pulling");
    setSyncMsg(isFirstSync
      ? (zh ? "擷取完整 Strava 歷史中…" : "Pulling full Strava history…")
      : (zh ? "擷取新活動中…" : "Pulling new activities…"));

    try {
      if (isFirstSync) {
        const r = await fetch(`/api/strava/full-sync/${clientId}`, { method: "POST" });
        if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
        const reader = r.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const data = JSON.parse(line) as
              | { page: number; total_so_far: number }
              | { done: true; total: number }
              | { error: string; detail?: string };
            if ("error" in data) throw new Error(data.detail ? `${data.error} — ${data.detail}` : data.error);
            if ("done" in data) {
              setSyncStage("done");
              setSyncMsg(zh
                ? `已擷取 ${data.total} 筆歷史活動 ✓`
                : `${data.total} historical activit${data.total === 1 ? "y" : "ies"} pulled ✓`);
            } else {
              setSyncMsg(zh
                ? `擷取 Strava 歷史中… 第 ${data.page} 頁 · 已取得 ${data.total_so_far} 筆`
                : `Pulling Strava history… page ${data.page} · ${data.total_so_far} fetched`);
            }
          }
        }
      } else {
        const r = await fetch(`/api/strava/sync/${clientId}`, { method: "POST" });
        if (!r.ok) {
          const err = await r.json().catch(() => null) as { error?: string; body?: string; detail?: string } | null;
          throw new Error(err ? [err.error, err.body, err.detail].filter(Boolean).join(" — ") : `${r.status}`);
        }
        const j = (await r.json()) as { pulled: number };
        setSyncStage("done");
        setSyncMsg(
          j.pulled === 0
            ? (zh ? "已是最新 ✓" : "Already up to date ✓")
            : (zh ? `已擷取 ${j.pulled} 筆新活動 ✓` : `${j.pulled} new activit${j.pulled === 1 ? "y" : "ies"} pulled ✓`),
        );
      }
      await refetchActivities();
      router.refresh();
    } catch (e) {
      setSyncStage("error");
      const msg = (e as Error).message;
      // Show whatever the server passed back — Strava's own status + body names
      // the real cause. Only "not_connected" gets a short friendly line since it
      // has no Strava body to show.
      if (msg.includes("not_connected")) {
        setSyncMsg(zh ? "尚未連結 Strava。" : "Strava is not connected.");
      } else {
        setSyncMsg(`${zh ? "同步失敗：" : "Sync failed:"} ${msg}`);
      }
    }
  }

  async function disconnect() {
    if (!confirm(zh ? "中斷 Strava 連結？已儲存的權杖將被移除。" : "Disconnect Strava? Stored tokens will be removed.")) return;

    const deleteActivities = confirm(
      zh
        ? `同時刪除為此客戶儲存的所有 Strava 活動？\n\n確定 = 永久刪除活動\n取消 = 保留活動（僅移除 Strava 連結）`
        : `Also delete all Strava activities stored for this client?\n\n` +
          `OK = delete activities permanently\n` +
          `Cancel = keep activities (just remove the Strava connection)`,
    );

    setDisconnecting(true);
    try {
      const r = await fetch(`/api/strava/disconnect/${clientId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete_activities: deleteActivities }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as { deletedActivities: number };
      if (deleteActivities) {
        setActivities([]);
        setSyncMsg(zh ? `已中斷連結 · 已刪除 ${j.deletedActivities} 筆活動` : `Disconnected · ${j.deletedActivities} activities deleted`);
      } else {
        setSyncMsg(zh ? "已中斷連結 · 活動已保留" : "Disconnected · activities kept");
      }
      setJustDisconnected(true);
      router.refresh();
    } finally {
      setDisconnecting(false);
    }
  }

  // Re-check the connection from the server. The client connects Strava on
  // their own device, so after they finish the trainer's card still reads
  // "Not connected" until the page re-renders — this lets them refresh in place.
  async function refreshConnection() {
    setRefreshing(true);
    try {
      await refetchActivities();
      router.refresh();
    } finally {
      // router.refresh() re-renders from the server without a completion hook,
      // so clear the spinner after a short beat.
      setTimeout(() => setRefreshing(false), 700);
    }
  }

  async function seed() {
    setSeeding(true);
    try {
      const r = await fetch(`/api/strava/dev-seed/${clientId}`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      router.refresh();
    } finally {
      setSeeding(false);
    }
  }

  const types = ["All", ...Array.from(new Set(activities.map((a) => a.type).filter(Boolean) as string[])).sort()];
  const filtered = typeFilter === "All" ? activities : activities.filter((a) => a.type === typeFilter);

  const weeks = RANGES.find((r) => r.label === range)!.weeks;
  const data = buildWeekly(filtered, weeks);
  const hasData = activities.length > 0;

  const rangeStart = new Date(); rangeStart.setDate(rangeStart.getDate() - weeks * 7);
  const rangeItems = filtered.filter((a) => new Date(a.started_at) >= rangeStart);
  const consistency = consistencyStats(rangeItems, weeks);
  const insights = generateInsights(data, rangeItems, consistency);
  const rangeZones = aggregateZones(rangeItems);
  const zoneTotal = rangeZones.z1 + rangeZones.z2 + rangeZones.z3 + rangeZones.z4 + rangeZones.z5;
  const easyPct = zoneTotal ? ((rangeZones.z1 + rangeZones.z2) / zoneTotal) * 100 : 0;
  const modPct  = zoneTotal ? (rangeZones.z3 / zoneTotal) * 100 : 0;
  const hardPct = zoneTotal ? ((rangeZones.z4 + rangeZones.z5) / zoneTotal) * 100 : 0;
  const loadClass = classifyLoad(easyPct, modPct, hardPct);
  const gStats = goalStats(activities);

  return (
    <div className="glass" style={{ borderRadius: T.radius.card, padding: "22px 24px" }}>

      {/* ── Title row ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t("sa.title")}</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{t("sa.subtitle")}</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() => setRange(r.label)}
              style={{
                fontSize: 10, fontWeight: 600, padding: "3px 9px",
                borderRadius: 99,
                background: range === r.label ? "rgba(196,148,82,0.25)" : "transparent",
                border: `1px solid ${range === r.label ? "rgba(196,148,82,0.5)" : T.border}`,
                color: range === r.label ? "#e4c08c" : T.muted,
                cursor: "pointer",
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Strava status row ─────────────────────────────────────── */}
      <div style={{
        marginBottom: 12,
        background: "rgba(0,0,0,0.15)", borderRadius: 8,
        border: `1px solid ${T.border}`,
        overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 10px" }}>
          <StravaLogo size={18} />
          <span style={{ fontSize: 11, color: T.muted, flex: "1 1 auto" }}>
            {connected
              ? <span data-testid="strava-connected">{t("sa.connected")} {athleteId}</span>
              : <span data-testid="strava-not-connected">{t("sa.notConnected")}</span>}
          </span>

          {connected && (
            <>
              <button
                onClick={() => setSyncModalOpen(true)}
                disabled={syncStage === "pulling"}
                data-testid="strava-sync-now"
                style={{
                  fontSize: 11, padding: "4px 11px", borderRadius: 99,
                  border: `1px solid ${T.border}`, background: "transparent",
                  color: T.accent,
                  cursor: syncStage === "pulling" ? "not-allowed" : "pointer",
                  opacity: syncStage === "pulling" ? 0.7 : 1,
                }}
              >
                {syncStage === "pulling"
                  ? <Spinner emoji="⬇️" label={t("sa.pulling")} />
                  : t("sa.syncNow")}
              </button>
              <button
                onClick={backfillHr}
                disabled={hrBackfillBusy || (hrMissing !== null && hrMissing === 0)}
                data-testid="strava-backfill-hr"
                style={{
                  fontSize: 11, padding: "4px 11px", borderRadius: 99,
                  border: `1px solid ${(hrMissing !== null && hrMissing === 0) ? T.border : "rgba(252,76,2,0.4)"}`,
                  background: "transparent",
                  color: (hrMissing !== null && hrMissing === 0) ? T.mutedMid : "#FC4C02",
                  cursor: hrBackfillBusy ? "not-allowed" : (hrMissing !== null && hrMissing === 0) ? "default" : "pointer",
                  opacity: hrBackfillBusy ? 0.7 : 1,
                }}
                title={
                  hrMissing === null
                    ? "Checking…"
                    : hrMissing === 0
                      ? "All activities have HR zone data"
                      : `${hrMissing} activit${hrMissing === 1 ? "y" : "ies"} pending — up to 100 processed per run, rest backfill on next hourly cycle`
                }
              >
                {hrBackfillBusy
                  ? <Spinner emoji="💓" label={t("sa.backfilling")} />
                  : hrMissing === null
                    ? t("sa.backfillHr")
                    : hrMissing === 0
                      ? t("sa.hrDone")
                      : `${t("sa.backfillHr")} (${hrMissing})`}
              </button>
              <button
                onClick={disconnect}
                disabled={disconnecting}
                data-testid="strava-disconnect"
                style={{
                  fontSize: 11, padding: "4px 11px", borderRadius: 99,
                  border: `1px solid ${T.border}`, background: "transparent",
                  color: T.mutedMid, cursor: disconnecting ? "not-allowed" : "pointer",
                  opacity: disconnecting ? 0.7 : 1,
                }}
              >
                {disconnecting ? "…" : t("sa.disconnect")}
              </button>
              <StravaDeleteDataButton
                clientId={clientId}
                clientName={clientName}
                activityCount={activities.length}
                onDeleted={() => {
                  setActivities([]);
                  setSyncMsg(zh ? "已刪除所有 Strava 資料" : "All Strava data deleted");
                  setJustDisconnected(true);
                }}
              />
            </>
          )}

          {/* Re-check the connection once the client has finished connecting on
              their own device (webhook/OAuth completes out of band). */}
          {!connected && (
            <button
              onClick={refreshConnection}
              disabled={refreshing}
              data-testid="strava-refresh"
              style={{
                fontSize: 11, padding: "4px 11px", borderRadius: 99,
                border: `1px solid ${T.border}`, background: "transparent",
                color: T.accent,
                cursor: refreshing ? "not-allowed" : "pointer",
                opacity: refreshing ? 0.7 : 1,
              }}
            >
              {refreshing
                ? <Spinner emoji="🔄" label={t("sa.refreshing")} />
                : t("sa.refresh")}
            </button>
          )}

          {/* Inviting/connecting is trainer-only — hide the invite link and the
              dev-seed action in the client portal. */}
          {!connected && stravaConfigured && !portal && (
            <StravaInviteButton clientId={clientId} />
          )}

          {!connected && portal && (
            <span data-testid="strava-portal-not-connected" style={{ fontSize: 10, color: T.muted, lineHeight: 1.4 }}>
              {t("sa.portalNotConnected")}
            </span>
          )}

          {!stravaConfigured && !portal && (
            <button
              onClick={seed}
              disabled={seeding}
              data-testid="seed-activities"
              style={{
                fontSize: 11, padding: "4px 11px", borderRadius: 99,
                border: `1px solid ${T.border}`, background: "transparent",
                color: T.accent, cursor: seeding ? "not-allowed" : "pointer",
              }}
            >
              {seeding ? <Spinner emoji="🌱" label={t("sa.seeding")} /> : t("sa.seed")}
            </button>
          )}
        </div>

        {/* Stage / progress status line */}
        {syncMsg && (
          <div style={{
            fontSize: 10,
            display: "flex", alignItems: "center", gap: 6,
            color: syncStage === "error"
              ? "#f87171"
              : syncStage === "done"
                ? "#86a378"
                : T.mutedMid,
            padding: "5px 10px 7px",
            borderTop: `1px solid ${T.border}`,
          }} data-testid="sync-msg">
            {syncStage !== "idle" && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 99,
                background: "rgba(255,255,255,0.06)", color: T.mutedMid,
                letterSpacing: "0.05em", textTransform: "uppercase",
              }}>
                {syncStage === "pulling" ? (zh ? "擷取中" : "pulling")
                  : syncStage === "done" ? (zh ? "完成" : "done")
                  : (zh ? "錯誤" : "error")}
              </span>
            )}
            <span>{syncMsg}</span>
          </div>
        )}

        {hrBackfillMsg && (
          <div style={{
            fontSize: 10, color: T.mutedMid,
            padding: "5px 10px 7px",
            borderTop: `1px solid ${T.border}`,
          }} data-testid="hr-backfill-msg">
            <span style={{
              fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 99,
              background: "rgba(255,255,255,0.06)", color: T.mutedMid,
              letterSpacing: "0.05em", textTransform: "uppercase", marginRight: 6,
            }}>
              {zh ? "心率回補" : "HR backfill"}
            </span>
            {hrBackfillMsg}
          </div>
        )}

        {justDisconnected && !connected && (
          <div style={{
            fontSize: 10, color: T.muted, lineHeight: 1.4,
            padding: "5px 10px 7px", borderTop: `1px solid ${T.border}`,
          }} data-testid="strava-disconnected-tip">
            {portal ? (
              t("sa.portalReconnectTip")
            ) : (
              <>
                {t("sa.disconnectedTipPre")}{" "}
                <a href="https://www.strava.com/" target="_blank" rel="noreferrer" style={{ color: T.accent }}>strava.com</a>{" "}
                {t("sa.disconnectedTipPost")}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Legend + type filter ───────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          {LEGEND.map((l) => (
            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: T.mutedMid }}>
              <span style={{ width: 16, height: 2, background: l.color, borderRadius: 2, display: "inline-block" }} />
              {l.label}
            </div>
          ))}
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{
            fontSize: 11, padding: "4px 10px",
            borderRadius: 8,
            border: `1px solid ${T.border}`,
            background: "rgba(255,255,255,0.05)",
            color: typeFilter === "All" ? T.muted : "#bcd3b8",
            cursor: "pointer",
            outline: "none",
          }}
        >
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {!hasData ? (
        <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: T.muted }}>
          {t("sa.noActivities")}{" "}
          {connected ? t("sa.hintSync") : stravaConfigured ? t("sa.hintConnect") : t("sa.hintSeed")}
        </div>
      ) : (
        <>
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data}
                margin={{ top: 4, right: 4, bottom: 18, left: -20 }}
                onMouseMove={(s) => {
                  const row = s?.activePayload?.[0]?.payload as WeekRow | undefined;
                  if (row) setHoveredWeek(row);
                }}
                onMouseLeave={() => setHoveredWeek(null)}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10, fontFamily: T.font.sans }}
                  axisLine={false} tickLine={false}
                  label={{ value: t("sa.weekAxis"), position: "insideBottom", offset: -2, fontSize: 10, fill: "rgba(255,255,255,0.18)", textAnchor: "middle" }}
                />
                <YAxis yAxisId="sessions" hide domain={[0, "dataMax + 2"]} />
                <YAxis yAxisId="dist"     hide domain={[0, "dataMax + 5"]} />
                <YAxis yAxisId="dur"      hide domain={[0, "dataMax + 1"]} />
                <YAxis yAxisId="hr"       hide domain={[40, "dataMax + 20"]} />
                <Tooltip content={() => null} cursor={{ fill: "rgba(244,237,226,0.04)" }} />
                <Bar  yAxisId="sessions" dataKey="sessions" fill="rgba(196,148,82,0.35)" radius={[3,3,0,0]} />
                <Line yAxisId="dist"     dataKey="km"       stroke="#86a378" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#86a378", strokeWidth: 0 }} />
                <Line yAxisId="dur"      dataKey="hrs"      stroke="#bcd3b8" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#bcd3b8", strokeWidth: 0 }} />
                <Line yAxisId="hr"       dataKey="avgHr"    stroke="#f4a7a7" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#f4a7a7", strokeWidth: 0 }} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {hoveredWeek && <WeekDetail row={hoveredWeek} />}

          {/* ── Insight panels ─────────────────────────────────────── */}
          <div style={{
            marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.border}`,
            display: "flex", flexDirection: "column", gap: 16,
          }}>
            {goal && (
              <div>
                <PanelHeader>{t("sa.goal")}</PanelHeader>
                <div style={{ fontSize: 13, color: "#e4c08c", fontWeight: 600, lineHeight: 1.4, marginBottom: 6 }}>
                  &ldquo;{goal}&rdquo;
                </div>
                {gStats && (
                  <div style={{ fontSize: 11, color: T.mutedMid, lineHeight: 1.6 }}>
                    <strong style={{ color: T.accent }}>{gStats.weeksTraining}</strong> {t("sa.wksTraining")} ·{" "}
                    <strong style={{ color: T.accent }}>{gStats.totalSessions}</strong> {t("sa.totalSessions")} ·{" "}
                    <strong style={{ color: T.accent }}>{gStats.sessionsPerWeek.toFixed(1)}</strong>{t("sa.perWk")}
                    {gStats.topType && (
                      <> · <strong style={{ color: T.accent }}>{gStats.topTypePct}%</strong> {gStats.topType}</>
                    )}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18 }}>
              {/* Training load distribution */}
              <div>
                <PanelHeader>{t("sa.trainingLoad")} · {range}</PanelHeader>
                {zoneTotal === 0 ? (
                  <div style={{ fontSize: 11, color: T.muted }}>
                    {t("sa.noZoneRange")}
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", marginBottom: 6 }}>
                      {easyPct > 0 && <div style={{ flex: easyPct, background: "#86a378" }} title={`Easy (Z1+Z2): ${easyPct.toFixed(0)}%`} />}
                      {modPct  > 0 && <div style={{ flex: modPct,  background: "#e4c08c" }} title={`Moderate (Z3): ${modPct.toFixed(0)}%`} />}
                      {hardPct > 0 && <div style={{ flex: hardPct, background: "#f47a7a" }} title={`Hard (Z4+Z5): ${hardPct.toFixed(0)}%`} />}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 8 }}>
                      <span style={{ color: "#86a378" }}>{t("sa.easy")} {easyPct.toFixed(0)}%</span>
                      <span style={{ color: "#e4c08c" }}>{t("sa.mod")} {modPct.toFixed(0)}%</span>
                      <span style={{ color: "#f47a7a" }}>{t("sa.hard")} {hardPct.toFixed(0)}%</span>
                    </div>
                    <div style={{ fontSize: 11, lineHeight: 1.5 }}>
                      <span style={{ color: loadClass.tone, fontWeight: 600 }}>{t(loadClass.labelKey)}</span>
                      <span style={{ color: T.muted }}> · {t(loadClass.noteKey)}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Consistency */}
              <div>
                <PanelHeader>{t("sa.consistency")} · {range}</PanelHeader>
                {(() => {
                  const dayMax = Math.max(...consistency.dayBuckets, 1);
                  const dayLabels = ["M", "T", "W", "T", "F", "S", "S"];
                  return (
                    <>
                      <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 40, marginBottom: 6 }}>
                        {consistency.dayBuckets.map((v, i) => (
                          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                            <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end" }}>
                              <div style={{
                                width: "100%", height: `${(v / dayMax) * 100}%`, minHeight: 2,
                                background: v > 0 ? "rgba(228,192,140,0.6)" : "rgba(255,255,255,0.06)",
                                borderRadius: 2,
                              }} title={`${v} sessions`} />
                            </div>
                            <span style={{ fontSize: 8, color: T.muted }}>{dayLabels[i]}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ fontSize: 11, color: T.mutedMid, lineHeight: 1.6 }}>
                        <strong style={{ color: "#e4c08c" }}>{consistency.sessionsPerWeek.toFixed(1)}</strong> {t("sa.sessionsPerWk")} ·{" "}
                        <strong style={{ color: "#86a378" }}>{consistency.longestStreak}d</strong> {t("sa.longestStreak")}
                        {consistency.daysSinceLast >= 0 && (
                          <> · <strong style={{ color: consistency.daysSinceLast >= 4 ? "#f47a7a" : T.mutedMid }}>
                            {consistency.daysSinceLast}d
                          </strong> {t("sa.sinceLast")}</>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Insights feed */}
            {insights.length > 0 && (
              <div>
                <PanelHeader>{t("sa.insights")}</PanelHeader>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {insights.map((s, i) => (
                    <li key={i} style={{ fontSize: 11.5, color: T.mutedMid, lineHeight: 1.5 }}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
      <PoweredByStrava height={12} align="right" />

      {syncModalOpen && modalMounted && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
          }}
          onClick={() => setSyncModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            data-testid="strava-sync-modal"
            style={{
              borderRadius: T.radius.card, padding: 28, maxWidth: 480, width: "100%",
              display: "flex", flexDirection: "column", gap: 14,
              background: "#1c2418",
              border: `1px solid ${T.border}`,
              boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
            }}
          >
            <div>
              <div style={{ fontFamily: T.font.mono, fontSize: 18, color: T.accent }}>
                {t("sa.modalTitle")}
              </div>
              <div style={{ fontSize: 12, color: T.muted, marginTop: 10, lineHeight: 1.6 }}>
                {t("sa.modalIntro")}
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  <li>{t("sa.modalItem1")}</li>
                  <li>{t("sa.modalItem2")}</li>
                  <li>{t("sa.modalItem3")}</li>
                  <li>{t("sa.modalItem4")}</li>
                </ul>
              </div>
              <div style={{
                fontSize: 12, color: T.mutedMid, marginTop: 12, lineHeight: 1.55,
                padding: "10px 12px", borderRadius: 8,
                background: "rgba(196,148,82,0.08)",
                border: "1px solid rgba(196,148,82,0.25)",
              }}>
                {activities.length === 0
                  ? t("sa.modalFirstSync")
                  : `${t("sa.modalIncrPre")} ${activities.length} ${t("sa.modalIncrPost")}`}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
              <button
                onClick={() => setSyncModalOpen(false)}
                data-testid="strava-sync-cancel"
                style={{
                  fontSize: 12, padding: "7px 14px", borderRadius: 99,
                  border: `1px solid ${T.border}`, background: "transparent",
                  color: T.muted, cursor: "pointer",
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => { setSyncModalOpen(false); runSync(); }}
                data-testid="strava-sync-confirm"
                style={{
                  fontSize: 12, padding: "7px 16px", borderRadius: 99,
                  border: `1px solid ${T.accent}`,
                  background: T.accent,
                  color: "#1c2418",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t("sa.startSync")}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
