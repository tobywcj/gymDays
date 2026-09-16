"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import type { CalendarSession } from "@/lib/sessions";

type Props = {
  sessions: CalendarSession[];
  locale: string;
  todayIso: string; // "YYYY-MM-DD"
};

const pad = (n: number) => String(n).padStart(2, "0");
const MAX_CHIPS = 3;

export default function SessionCalendar({ sessions, locale, todayIso }: Props) {
  const { t } = useI18n();
  const intlLocale = locale === "zh" ? "zh-TW" : "en-US";

  const [ty, tm] = useMemo(() => {
    const [y, m] = todayIso.split("-").map(Number);
    return [y, m - 1];
  }, [todayIso]);

  const [cursor, setCursor] = useState({ year: ty, month: tm });
  const [selected, setSelected] = useState<CalendarSession | null>(null);

  // Group sessions by their date key for O(1) cell lookups.
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarSession[]>();
    for (const s of sessions) {
      const arr = map.get(s.date);
      if (arr) arr.push(s);
      else map.set(s.date, [s]);
    }
    // Stable order within a day: by client name.
    for (const arr of map.values()) arr.sort((a, b) => a.clientName.localeCompare(b.clientName));
    return map;
  }, [sessions]);

  // Locale-aware weekday + month labels via Intl (avoids a pile of i18n keys).
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat(intlLocale, { weekday: "short" }).format(new Date(2023, 0, 1 + i)),
      ),
    [intlLocale],
  );
  const monthLabel = new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric" }).format(
    new Date(cursor.year, cursor.month, 1),
  );

  // Build the month grid (leading blanks + days, padded to full weeks).
  const cells = useMemo(() => {
    const firstWeekday = new Date(cursor.year, cursor.month, 1).getDay();
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const out: (string | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(`${cursor.year}-${pad(cursor.month + 1)}-${pad(d)}`);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [cursor]);

  // Month-scoped metrics.
  const { monthSessionCount, monthClientCount } = useMemo(() => {
    const prefix = `${cursor.year}-${pad(cursor.month + 1)}-`;
    const ids = new Set<string>();
    let count = 0;
    for (const s of sessions) {
      if (s.date.startsWith(prefix)) {
        count++;
        ids.add(s.clientId);
      }
    }
    return { monthSessionCount: count, monthClientCount: ids.size };
  }, [sessions, cursor]);

  // Esc closes the panel.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const step = (delta: number) =>
    setCursor((c) => {
      const m = c.month + delta;
      return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  const goToday = () => setCursor({ year: ty, month: tm });

  const navBtn = (label: React.ReactNode, onClick: () => void, key?: string) => (
    <button
      key={key}
      onClick={onClick}
      style={{
        background: "rgba(0,0,0,0.25)",
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        color: T.mutedMid,
        cursor: "pointer",
        fontSize: 13,
        fontFamily: T.font.sans,
        padding: "7px 12px",
        display: "flex",
        alignItems: "center",
        lineHeight: 1,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header: title + month nav + metrics */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: T.font.sans, fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>
            {t("calendar.title")}
          </div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{t("calendar.subtitle")}</div>
        </div>
        <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: T.font.mono, fontSize: 22, fontWeight: 700, color: T.accent }}>{monthSessionCount}</div>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted }}>
              {t("calendar.sessionsThisMonth")}
            </div>
          </div>
          <div style={{ width: 1, height: 34, background: T.border }} />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: T.font.mono, fontSize: 22, fontWeight: 700, color: T.accentMoss }}>{monthClientCount}</div>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted }}>
              {t("calendar.clientsTraining")}
            </div>
          </div>
        </div>
      </div>

      {/* Month switcher */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {navBtn("‹", () => step(-1), "prev")}
        <div style={{ fontFamily: T.font.sans, fontSize: 16, fontWeight: 600, minWidth: 170, textAlign: "center" }}>
          {monthLabel}
        </div>
        {navBtn("›", () => step(1), "next")}
        {navBtn(t("calendar.today"), goToday, "today")}
      </div>

      {sessions.length === 0 ? (
        <div className="glass" style={{ borderRadius: T.radius.card, padding: 40, textAlign: "center", color: T.muted, fontSize: 13 }}>
          {t("calendar.empty")}
        </div>
      ) : (
        <div className="glass" style={{ borderRadius: T.radius.card, padding: 16, overflow: "hidden" }}>
          {/* Weekday header */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 6 }}>
            {weekdays.map((w) => (
              <div
                key={w}
                style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: T.muted, textAlign: "center", padding: "2px 0" }}
              >
                {w}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
            {cells.map((dateKey, i) => {
              if (!dateKey) return <div key={`b${i}`} style={{ minHeight: 104 }} />;
              const dayNum = Number(dateKey.slice(-2));
              const daySessions = byDate.get(dateKey) ?? [];
              const isToday = dateKey === todayIso;
              return (
                <div
                  key={dateKey}
                  style={{
                    minHeight: 104,
                    borderRadius: 10,
                    border: `1px solid ${isToday ? "rgba(196,148,82,0.55)" : T.border}`,
                    background: isToday ? "rgba(196,148,82,0.10)" : "rgba(0,0,0,0.18)",
                    padding: 7,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      fontFamily: T.font.mono,
                      fontSize: 12,
                      fontWeight: isToday ? 700 : 500,
                      color: isToday ? T.accent : T.mutedMid,
                      alignSelf: "flex-end",
                    }}
                  >
                    {dayNum}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {daySessions.slice(0, MAX_CHIPS).map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setSelected(s)}
                        title={`${s.clientName} · ${s.focus}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          width: "100%",
                          textAlign: "left",
                          background: `${s.color}22`,
                          border: `1px solid ${s.color}55`,
                          borderLeft: `3px solid ${s.color}`,
                          borderRadius: 6,
                          padding: "3px 6px",
                          cursor: "pointer",
                          color: T.text,
                          overflow: "hidden",
                        }}
                      >
                        <span style={{ fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>
                          {s.clientName}
                        </span>
                        {s.focus && (
                          <span style={{ fontSize: 9.5, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 2, minWidth: 0 }}>
                            {s.focus}
                          </span>
                        )}
                      </button>
                    ))}
                    {daySessions.length > MAX_CHIPS && (
                      <button
                        onClick={() => setSelected(daySessions[MAX_CHIPS])}
                        style={{ background: "none", border: "none", cursor: "pointer", color: T.muted, fontSize: 10, textAlign: "left", padding: "1px 6px" }}
                      >
                        +{daySessions.length - MAX_CHIPS} {t("calendar.more")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selected && (
        <SessionPanel session={selected} onClose={() => setSelected(null)} intlLocale={intlLocale} t={t} />
      )}
    </div>
  );
}

function SessionPanel({
  session,
  onClose,
  intlLocale,
  t,
}: {
  session: CalendarSession;
  onClose: () => void;
  intlLocale: string;
  t: (k: string) => string;
}) {
  const router = useRouter();
  const [y, m, d] = session.date.split("-").map(Number);
  const dateLabel = new Intl.DateTimeFormat(intlLocale, { weekday: "long", month: "long", day: "numeric" }).format(
    new Date(y, m - 1, d),
  );

  // Trainer feedback (only persistable on real `sessions` rows). `baseline` is
  // the last-persisted value; it advances on save so `dirty`/"Saved" stay correct
  // even though the parent's `selected` object keeps the pre-save feedback.
  const [feedback, setFeedback] = useState(session.feedback ?? "");
  const [baseline, setBaseline] = useState(session.feedback ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const dirty = feedback.trim() !== baseline.trim();

  async function saveFeedback() {
    if (!session.sessionId || saving) return;
    setSaving(true);
    setSaveErr(null);
    setSaved(false);
    try {
      const r = await fetch(`/api/sessions/${session.sessionId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "error");
      setBaseline(feedback);
      setSaved(true);
      router.refresh(); // re-fetch calendar data so the new feedback persists in props
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 24,
      }}
    >
      <div
        className="glass"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "86vh",
          overflowY: "auto",
          borderRadius: T.radius.card,
          borderTop: `3px solid ${session.color}`,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: session.color, flexShrink: 0 }} />
              <span style={{ fontSize: 16, fontWeight: 700 }}>{session.clientName}</span>
            </div>
            <div style={{ fontSize: 12, color: T.mutedMid, marginTop: 4 }}>
              {dateLabel}
              {session.dayLabel ? ` · ${session.dayLabel}` : ""}
            </div>
            {session.focus && (
              <div
                style={{
                  display: "inline-block",
                  marginTop: 8,
                  fontSize: 11,
                  fontWeight: 600,
                  color: session.color,
                  background: `${session.color}1f`,
                  border: `1px solid ${session.color}55`,
                  borderRadius: 99,
                  padding: "3px 10px",
                }}
              >
                {session.focus}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: "rgba(0,0,0,0.3)", border: `1px solid ${T.border}`, borderRadius: 8, color: T.mutedMid, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "5px 9px", flexShrink: 0 }}
          >
            ✕
          </button>
        </div>

        {/* Exercise list */}
        <div>
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: T.muted,
              marginBottom: 8,
            }}
          >
            {t("calendar.exercises")} · {session.exercises.length}
          </div>

          {session.exercises.length === 0 ? (
            <div style={{ fontSize: 12, color: T.muted }}>{t("calendar.noExercises")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 48px 56px",
                  gap: 8,
                  fontSize: 9.5,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: T.muted,
                  padding: "0 0 6px",
                  borderBottom: `1px solid ${T.border}`,
                }}
              >
                <span>{t("calendar.exercises")}</span>
                <span style={{ textAlign: "right" }}>{t("calendar.sets")}</span>
                <span style={{ textAlign: "right" }}>{t("calendar.reps")}</span>
              </div>
              {session.exercises.map((ex, j) => (
                <div key={j} style={{ padding: "8px 0", borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 48px 56px", gap: 8, fontSize: 13, alignItems: "baseline" }}>
                    <span style={{ color: ex.name ? T.text : "#f87171", fontWeight: 500 }}>
                      {ex.name ?? `(${t("program.missing")})`}
                    </span>
                    <span style={{ textAlign: "right", fontFamily: T.font.mono, color: T.mutedMid }}>{ex.sets}</span>
                    <span style={{ textAlign: "right", fontFamily: T.font.mono, color: T.mutedMid }}>{ex.reps}</span>
                  </div>
                  {(ex.muscleGroup || ex.notes) && (
                    <div style={{ display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
                      {ex.muscleGroup && (
                        <span style={{ fontSize: 10, color: T.muted, textTransform: "capitalize" }}>{ex.muscleGroup}</span>
                      )}
                      {ex.notes && <span style={{ fontSize: 11, color: T.muted, fontStyle: "italic" }}>{ex.notes}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Trainer feedback — feeds the Programme Last Session Analysis */}
        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.muted, marginBottom: 6 }}>
            📝 {t("calendar.feedback")}
          </div>
          {session.sessionId ? (
            <>
              <div style={{ fontSize: 11, color: T.muted, marginBottom: 8 }}>{t("calendar.feedbackHint")}</div>
              <textarea
                value={feedback}
                onChange={(e) => { setFeedback(e.target.value); setSaved(false); }}
                placeholder={t("calendar.feedbackPlaceholder")}
                data-testid="session-feedback"
                rows={3}
                style={{
                  width: "100%", boxSizing: "border-box", resize: "vertical",
                  background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 8,
                  padding: "8px 10px", color: T.text, fontSize: 12.5, fontFamily: T.font.sans, outline: "none",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <button
                  onClick={saveFeedback}
                  disabled={saving || !dirty}
                  data-testid="save-feedback"
                  style={{
                    fontSize: 12, padding: "7px 14px", borderRadius: 99,
                    background: "linear-gradient(135deg, rgba(122,148,140,0.95) 0%, rgba(72,98,90,0.95) 100%)",
                    border: "1px solid rgba(255,252,245,0.25)", color: "#fffdf6", fontWeight: 600,
                    cursor: saving || !dirty ? "not-allowed" : "pointer", opacity: saving || !dirty ? 0.6 : 1,
                  }}
                >
                  {saving ? t("calendar.saving") : t("calendar.saveFeedback")}
                </button>
                {saved && !dirty && <span style={{ fontSize: 11, color: "#a7c39c" }}>✓ {t("calendar.feedbackSaved")}</span>}
                {saveErr && <span style={{ fontSize: 11, color: "#f0a896", fontFamily: T.font.mono }}>{saveErr}</span>}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11, color: T.muted, fontStyle: "italic" }}>{t("calendar.feedbackOnlyScheduled")}</div>
          )}
        </div>

        <Link
          href={`/clients/${session.clientId}/program`}
          style={{
            alignSelf: "flex-start",
            fontSize: 12,
            color: T.accent,
            textDecoration: "none",
            border: `1px solid ${T.border}`,
            borderRadius: 99,
            padding: "7px 14px",
          }}
        >
          {t("calendar.viewProgram")} →
        </Link>
      </div>
    </div>
  );
}
