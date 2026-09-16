"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";
import Spinner from "./Spinner";
import ThoughtLine, { plainThought } from "./ThoughtLine";
import LiveSources from "./LiveSources";
import WindowSlider from "./WindowSlider";
import { useI18n } from "@/lib/i18n-context";
import { useAgentStream } from "@/lib/useAgentStream";
import PaidRetry from "./PaidRetry";

type Exercise = { exercise_id: string; sets: number | string; reps: number | string; notes?: string };
type Day = { day: string; focus: string; exercises: Exercise[] };
type Source = { title: string; url?: string | null };
type Plan = { days: Day[]; sources?: Source[] };

type ExerciseRow = { id: string; name: string; muscle_group: string | null };

type Props = {
  clientId: string;
  program: { week_start: string; plan: Plan } | null;
  exercises: ExerciseRow[];   // lookup table: exercise_id → name
  llms: { default: string; models: Record<string, string>; keys: { openai: boolean; anthropic: boolean } } | null;
  // Called after a successful regenerate. Lets a client-side host (e.g. the
  // global /programme page) re-fetch the program; server pages rely on router.refresh().
  onGenerated?: () => void;
};

type StagedItem = { exercise_id: string; name: string; sets: number | string; reps: number | string; notes: string };

export default function ProgramPanel({ clientId, program, exercises, llms, onGenerated }: Props) {
  const router = useRouter();
  const stream = useAgentStream();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(30);
  // Step-1 planning inputs.
  const [days, setDays] = useState(program?.plan?.days?.length || 4);
  const [ctx, setCtx] = useState<{ injuries: string[]; screening: string[] }>({ injuries: [], screening: [] });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [special, setSpecial] = useState("");
  // Session staging: trainer adds generated days here, then schedules them as a
  // session (same shape the Programme session box posts to /api/sessions).
  const [staged, setStaged] = useState<StagedItem[]>([]);
  const [when, setWhen] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [sessionMsg, setSessionMsg] = useState<string | null>(null);
  const busy = stream.running;
  const latestThought = stream.thoughts[stream.thoughts.length - 1];

  const exMap = new Map(exercises.map((e) => [e.id, e]));

  function addDayToSession(day: Day) {
    setSessionMsg(null);
    setStaged((prev) => {
      const next = [...prev];
      for (const ex of day.exercises) {
        if (next.some((s) => s.exercise_id === ex.exercise_id)) continue;
        next.push({
          exercise_id: ex.exercise_id,
          name: exMap.get(ex.exercise_id)?.name ?? ex.exercise_id.slice(0, 8),
          sets: ex.sets, reps: ex.reps, notes: ex.notes ?? "",
        });
      }
      return next;
    });
  }

  async function saveSession() {
    setSessionMsg(null);
    if (!when) { setSessionMsg(t("session.needDate")); return; }
    if (staged.length === 0) { setSessionMsg(t("session.needExercise")); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          scheduled_at: new Date(when).toISOString(),
          title: title || null,
          exercises: staged.map((s, i) => ({
            exercise_id: s.exercise_id, sets: s.sets, reps: s.reps, notes: s.notes, order: i,
          })),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
      setStaged([]); setWhen(""); setTitle("");
      setSessionMsg(t("session.saved"));
      router.refresh();
    } catch (e) {
      setSessionMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Load the client's background (injuries + screening considerations) so the
  // trainer can curate which ones to honor before generating. Default all ON.
  useEffect(() => {
    let live = true;
    fetch(`/api/client/${clientId}/planning-context`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return;
        const injuries: string[] = d.injuries ?? [];
        const screening: string[] = d.screening ?? [];
        setCtx({ injuries, screening });
        setSelected(new Set([...injuries, ...screening]));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [clientId]);

  function toggle(item: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(item) ? next.delete(item) : next.add(item);
      return next;
    });
  }

  async function generate() {
    setError(null);
    try {
      await stream.start(`/api/ai/planning/${clientId}/stream`, {
        window_days: windowDays,
        num_days: days,
        special_requirements: special.trim() || undefined,
        constraints: Array.from(selected),
      });
      router.refresh();
      onGenerated?.();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const bgItems = [
    ...ctx.injuries.map((s) => ({ s, icon: "🩹" })),
    ...ctx.screening.map((s) => ({ s, icon: "🩺" })),
  ];

  return (
    <div className="glass" style={{ borderRadius: T.radius.card, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 180px" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t("program.title")}</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
            {program
              ? <>{t("panel.weekOf")} <strong style={{ color: T.mutedMid }}>{program.week_start}</strong></>
              : t("program.empty")}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          <WindowSlider value={windowDays} onChange={setWindowDays} disabled={busy} />
          <button
            onClick={generate}
            disabled={busy || !llms}
            data-testid="run-planner"
            style={{
              fontSize: 12,
              padding: "7px 14px",
              borderRadius: 99,
              background: "linear-gradient(135deg, rgba(196,148,82,0.95) 0%, rgba(140,92,48,0.95) 100%)",
              border: "1px solid rgba(255,252,245,0.25)",
              color: "#fffdf6",
              fontWeight: 600,
              cursor: busy || !llms ? "not-allowed" : "pointer",
              opacity: busy || !llms ? 0.7 : 1,
              boxShadow: "0 1px 0 rgba(255,252,245,0.45) inset, 0 6px 20px rgba(140,92,48,0.45)",
            }}
          >
            {busy ? <Spinner emoji="📋" label={plainThought(latestThought) ?? t("common.generating")} /> : program ? t("program.regenerate") : t("program.generate")}
          </button>
        </div>
      </div>

      {/* ── Step 1 · plan inputs ─────────────────────────────────── */}
      <div
        data-testid="plan-inputs"
        style={{ background: "rgba(0,0,0,0.18)", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10, borderLeft: `3px solid ${T.border}` }}
      >
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.mutedMid }}>
          {t("program.step1")}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: T.muted }}>{t("program.daysLabel")}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => setDays((d) => Math.max(2, d - 1))} disabled={busy} style={stepBtn} aria-label="fewer days">−</button>
            <span data-testid="plan-days" style={{ fontSize: 13, fontWeight: 700, minWidth: 18, textAlign: "center" }}>{days}</span>
            <button onClick={() => setDays((d) => Math.min(6, d + 1))} disabled={busy} style={stepBtn} aria-label="more days">+</button>
          </div>
        </div>

        {bgItems.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, color: T.muted }}>{t("program.background")}</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {bgItems.map(({ s, icon }) => {
                const on = selected.has(s);
                return (
                  <button
                    key={s}
                    onClick={() => toggle(s)}
                    disabled={busy}
                    title={s}
                    data-testid="plan-constraint"
                    style={{
                      fontSize: 11, padding: "4px 9px", borderRadius: 99, cursor: busy ? "not-allowed" : "pointer",
                      border: `1px solid ${on ? "rgba(196,148,82,0.5)" : T.border}`,
                      background: on ? "rgba(196,148,82,0.18)" : "transparent",
                      color: on ? "#e4c08c" : T.muted,
                      maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                  >
                    {icon} {s} {on ? "✓" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <textarea
          value={special}
          onChange={(e) => setSpecial(e.target.value)}
          disabled={busy}
          rows={2}
          data-testid="plan-special"
          placeholder={t("program.specialPlaceholder")}
          style={{ background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 8, padding: "7px 9px", color: T.text, fontSize: 12, outline: "none", resize: "vertical", fontFamily: "inherit" }}
        />
      </div>

      {busy && <LiveSources sources={stream.sources} />}

      {busy && stream.thoughts.length > 0 && (
        <div
          data-testid="planner-thoughts"
          style={{
            display: "flex", flexDirection: "column", gap: 4,
            padding: "8px 12px", background: "rgba(0,0,0,0.18)",
            borderRadius: 8, borderLeft: `2px solid ${T.border}`,
            maxHeight: 140, overflowY: "auto",
          }}
        >
          {stream.thoughts.map((line, i) => (
            <div key={i} style={{
              fontSize: 11, color: T.muted, lineHeight: 1.45,
              fontFamily: T.font.mono,
              opacity: i === stream.thoughts.length - 1 ? 1 : 0.55,
            }}>
              <ThoughtLine line={line} />
            </div>
          ))}
        </div>
      )}

      {!llms && (
        <div data-testid="planner-service-down" style={{ fontSize: 12, color: T.muted }}>
          {t("panel.serviceDown")}{" "}
          <code style={{ fontFamily: T.font.mono, color: T.accent }}>uvicorn ai.main:app --port 8001</code>.
        </div>
      )}

      <PaidRetry stream={stream} />

      {error && (
        <div data-testid="planner-error" style={{ fontSize: 11, color: "#f87171", fontFamily: T.font.mono }}>
          {error}
        </div>
      )}

      {!busy && program && (program.plan?.days?.length ?? 0) === 0 && (
        <div data-testid="program-malformed" style={{ fontSize: 12, color: "#fbbf24" }}>
          {t("program.malformedPre")} <strong>{t("program.regenerate")}</strong> {t("program.malformedPost")}
        </div>
      )}

      {!busy && program && (program.plan?.days?.length ?? 0) > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {program.plan.days.map((day, i) => (
            <div
              key={i}
              data-testid="program-day"
              style={{
                background: "rgba(0,0,0,0.18)",
                borderRadius: 10,
                padding: "12px 14px",
                borderLeft: `3px solid ${T.accent}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {day.day}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: T.mutedMid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{day.focus}</div>
                  <button
                    onClick={() => addDayToSession(day)}
                    data-testid="add-day-to-session"
                    title={t("program.addToSessionHint")}
                    style={{
                      flexShrink: 0, fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 99,
                      background: "rgba(196,148,82,0.16)", border: "1px solid rgba(196,148,82,0.4)",
                      color: "#e4c08c", cursor: "pointer", whiteSpace: "nowrap",
                    }}
                  >
                    + {t("program.addToSession")}
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {day.exercises.map((ex, j) => {
                  const lookup = exMap.get(ex.exercise_id);
                  return (
                    <div
                      key={j}
                      data-testid="program-exercise"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 60px 70px 1fr",
                        gap: 8,
                        fontSize: 12,
                        color: T.mutedMid,
                        padding: "4px 0",
                      }}
                    >
                      <span style={{ color: lookup ? T.text : "#f87171" }}>
                        {lookup?.name ?? `(${t("program.missing")} ${ex.exercise_id.slice(0, 8)}…)`}
                      </span>
                      <span style={{ textAlign: "right" }}>{ex.sets}×</span>
                      <span style={{ textAlign: "right" }}>{ex.reps}</span>
                      <span style={{ color: T.muted, paddingLeft: 12 }}>{ex.notes || ""}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {(program.plan?.sources?.length ?? 0) > 0 && (
            <div data-testid="program-sources" style={{ marginTop: 4 }}>
              <div style={{
                fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
                color: "#e4c08c", marginBottom: 5,
                borderBottom: "1px solid rgba(196,148,82,0.2)", paddingBottom: 4,
              }}>
                {t("program.sources")}
              </div>
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                {program.plan!.sources!.map((s, i) => (
                  <li key={i} style={{ display: "flex", gap: 8, fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
                    <span style={{ color: "#e4c08c", flexShrink: 0 }}>·</span>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: T.accent, textDecoration: "underline" }}>
                        {s.title || s.url}
                      </a>
                    ) : (
                      <span>{s.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Session staging: schedule added days as a real session ── */}
      {staged.length > 0 && (
        <div
          data-testid="session-stage"
          style={{ background: "rgba(0,0,0,0.22)", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, borderLeft: `3px solid #e4c08c` }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#e4c08c" }}>
            🗓️ {t("program.nextSession")} · {staged.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 140, overflowY: "auto" }}>
            {staged.map((s, i) => (
              <div key={s.exercise_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, color: T.mutedMid }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{ color: T.muted, whiteSpace: "nowrap" }}>{s.sets}×{s.reps}</span>
                  <button onClick={() => setStaged((prev) => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: "#f0a896", cursor: "pointer", fontSize: 12 }}>✕</button>
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("session.titlePlaceholder")}
              style={{ flex: "1 1 120px", background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 8, padding: "6px 8px", color: T.text, fontSize: 12, outline: "none" }} />
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} data-testid="stage-datetime"
              style={{ flex: "1 1 160px", background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 8, padding: "6px 8px", color: T.text, fontSize: 12, outline: "none" }} />
          </div>
          {sessionMsg && (
            <div style={{ fontSize: 11, color: sessionMsg === t("session.saved") ? T.accentMoss : "#f0a896" }}>{sessionMsg}</div>
          )}
          <button onClick={saveSession} disabled={saving} data-testid="stage-save"
            style={{ alignSelf: "flex-start", fontSize: 12, padding: "7px 14px", borderRadius: 99, background: "linear-gradient(135deg, rgba(196,148,82,0.95), rgba(140,92,48,0.95))", border: "1px solid rgba(255,252,245,0.25)", color: "#fffdf6", fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
            {saving ? t("common.generating") : `${t("session.save")} (${staged.length})`}
          </button>
        </div>
      )}
    </div>
  );
}

const stepBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)", border: `1px solid ${T.border}`, borderRadius: 6,
  color: T.text, fontSize: 14, lineHeight: 1, cursor: "pointer", padding: "2px 9px",
};
