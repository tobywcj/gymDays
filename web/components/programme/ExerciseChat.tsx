"use client";

import { useEffect, useRef, useState } from "react";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { useAgentStream } from "@/lib/useAgentStream";
import type { ExerciseRow, Lang, KeyPoints, MuscleRegion } from "@/lib/exercise-library";
import { SUITABILITY_EMOJI, type Suitability } from "@/lib/exercise-suitability";
import { MUSCLE_LABELS } from "./MuscleMap";
import ExerciseIllustration from "./ExerciseIllustration";
import ExerciseVisual from "./ExerciseVisual";
import MarkdownSummary from "@/components/dashboard/MarkdownSummary";
import YouTubeEmbed, { extractYouTubeUrl } from "./YouTubeEmbed";
import Spinner from "@/components/dashboard/Spinner";
import LiveSources from "@/components/dashboard/LiveSources";
import ThoughtLine, { plainThought } from "@/components/dashboard/ThoughtLine";

type Source = { title: string; url?: string | null };
type CoachResult = { answer?: string; suitability?: string; alternatives?: string[]; video_url?: string; sources?: Source[] };
type Msg = { role: "user" | "coach"; text: string; sources?: Source[]; videoUrl?: string | null; running?: boolean; error?: string | null };

export function suitabilityLabel(level: Suitability["level"], name: string | null | undefined, t: (k: string) => string, locale: string): string {
  const word = t(`suit.${level}`);
  const emoji = SUITABILITY_EMOJI[level];
  if (!name) return `${emoji} ${word}`;
  return locale === "zh" ? `${emoji} ${name}：${word}` : `${emoji} ${word} ${t("coach.for")} ${name}`;
}

type Props = {
  ex: ExerciseRow;
  clientId: string | null;
  clientName?: string | null;
  caveat?: Suitability | null;
  autoAsk?: "caveat" | null;   // when "caveat", auto-fire the why+alternatives question on open
  onClose: () => void;
};

export default function ExerciseChat({ ex, clientId, clientName, caveat, autoAsk, onClose }: Props) {
  const { t, locale } = useI18n();
  const coach = useAgentStream();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [showKp, setShowKp] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const L = (v: Lang | null | undefined) => (v ? (locale === "zh" ? v.zh : v.en) : "");
  const name = locale === "zh" && ex.name_zh ? ex.name_zh : ex.name;
  const muscleLabel = (r: MuscleRegion) => (locale === "zh" ? MUSCLE_LABELS[r]?.zh : MUSCLE_LABELS[r]?.en) ?? r;
  const subtitle = (ex.primary_muscles ?? []).map(muscleLabel).join(" · ");
  const suit = clientId ? (caveat ?? null) : null;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const KP: { key: keyof KeyPoints; label: string }[] = [
    { key: "bodyPosition", label: t("kp.bodyPosition") },
    { key: "stabilization", label: t("kp.stabilization") },
    { key: "pathOfMotion", label: t("kp.pathOfMotion") },
    { key: "rangeOfMotion", label: t("kp.rangeOfMotion") },
    { key: "breathing", label: t("kp.breathing") },
    { key: "rhythm", label: t("kp.rhythm") },
  ];

  function compactExercise() {
    return {
      name: ex.name, name_zh: ex.name_zh, muscle_group: ex.muscle_group,
      equipment: ex.equipment, level: ex.level, tempo: ex.tempo,
      primary_muscles: ex.primary_muscles, secondary_muscles: ex.secondary_muscles,
      variations: (ex.variations ?? []).map((v) => v.name.en), key_points: ex.key_points,
    };
  }

  async function ask(question: string, mode: "qa" | "caveat") {
    if (coach.running || !question.trim()) return;
    const coachIdx = messages.length + 1;
    setMessages((m) => [...m, { role: "user", text: question }, { role: "coach", text: "", running: true }]);
    let streamErr: string | null = null;
    try {
      const r = (await coach.start(
        "/api/ai/exercise-coach/stream",
        { question, exercise: compactExercise(), client_id: clientId, mode },
        (ev) => { if (ev.type === "error") streamErr = ev.message; },
      )) as CoachResult | null;
      const answer = String(r?.answer ?? "").replace(/\\n/g, "\n").trim();
      const videoUrl = (r?.video_url as string) || extractYouTubeUrl(answer, ...(r?.sources ?? []).map((s) => s.url));
      setMessages((m) => m.map((msg, i) => i === coachIdx
        ? (answer
            ? { role: "coach", text: answer, sources: r?.sources, videoUrl, running: false }
            : { role: "coach", text: "", running: false, error: streamErr || t("coach.noResponse") })
        : msg));
    } catch (e) {
      const msg = streamErr || (e as Error).message || t("coach.noResponse");
      setMessages((m) => m.map((mm, i) => i === coachIdx ? { role: "coach", text: "", running: false, error: msg } : mm));
    }
  }

  // Fire the caveat (why + alternatives) question, passing the EXACT flag the
  // badge showed so the coach explains that reason, not a re-derived one. Used
  // by both the card "Why + alternatives" link (auto, below) and the in-chat
  // caveat badge.
  function askCaveat() {
    const flag = suit?.reasons?.length ? ` (system flag: ${suit.reasons.join("; ")})` : "";
    ask(t("coach.caveatPrompt") + flag, "caveat");
  }

  // Reset the thread AND (if opened via the card's "Why + alternatives" link)
  // auto-fire the caveat question — exactly once per opened exercise/client.
  // Guarded by an identity ref so React StrictMode's effect double-invoke can't
  // run the reset twice (which would wipe the just-asked message and leave the
  // chat empty with coach stuck "running").
  const initedKey = useRef<string | null>(null);
  useEffect(() => {
    const key = `${ex.id}|${clientId ?? ""}`;
    if (initedKey.current === key) return;
    initedKey.current = key;
    setMessages([]);
    if (autoAsk === "caveat") askCaveat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex.id, clientId, autoAsk]);

  const chips = [
    { label: t("coach.chipEasier"), mode: "qa" as const },
    { label: t("coach.chipNoBarbell"), mode: "qa" as const },
    { label: t("coach.chipShoulder"), mode: "qa" as const },
    { label: t("coach.chipHarder"), mode: "qa" as const },
    { label: `🎬 ${t("coach.findVideo")}`, mode: "qa" as const, q: t("coach.videoPrompt") },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* header */}
      <div style={{ padding: 16, borderBottom: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ background: "rgba(0,0,0,0.18)", borderRadius: 12, padding: 4, flexShrink: 0 }}>
            <ExerciseIllustration ex={ex} size={96} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{name}</div>
            <div style={{ fontSize: 11, color: T.muted }}>{subtitle}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {ex.level && <span style={chip("rgba(196,148,82,0.16)", "#e4c08c")}>{t(`level.${ex.level}`)}</span>}
              {ex.tempo && <span style={chip("rgba(122,148,140,0.16)", T.accentBlue)}>{t("programme.tempo")} {ex.tempo}</span>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: T.muted, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>

        {suit && (
          <button onClick={askCaveat} disabled={coach.running} data-testid="caveat-badge"
            style={{
              ...chip(suit.level === "avoid" ? "rgba(196,76,60,0.2)" : suit.level === "caution" ? "rgba(196,148,82,0.2)" : "rgba(134,163,120,0.2)", T.text),
              alignSelf: "flex-start", fontSize: 11, padding: "5px 11px", cursor: coach.running ? "default" : "pointer",
            }} title={suit.reasons.join(" ")}>
            {suitabilityLabel(suit.level, clientName, t, locale)} → {t("coach.whyAlt")}
          </button>
        )}

        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setShowKp((s) => !s)} style={{ fontSize: 11, color: T.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            {showKp ? "▾ " : "▸ "}{t("programme.keyPoints")}
          </button>
          {ex.imageUrl && (
            <button onClick={() => setShowPhoto((s) => !s)} style={{ fontSize: 11, color: T.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              {showPhoto ? "▾ " : "▸ "}📷 {t("programme.demoPhoto")}
            </button>
          )}
        </div>
        {showPhoto && ex.imageUrl && (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <ExerciseVisual ex={ex} size={200} />
          </div>
        )}
        {showKp && ex.key_points && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {KP.map(({ key, label }) => (
              <div key={key} style={{ fontSize: 11, lineHeight: 1.5 }}>
                <span style={{ color: "#e4c08c", fontWeight: 700 }}>{label}: </span>
                <span style={{ color: T.mutedMid }}>{L(ex.key_points![key])}</span>
              </div>
            ))}
            {L(ex.progression) && <div style={{ fontSize: 11 }}><span style={{ color: T.accentMoss, fontWeight: 700 }}>{t("programme.progression")}: </span><span style={{ color: T.mutedMid }}>{L(ex.progression)}</span></div>}
            {L(ex.regression) && <div style={{ fontSize: 11 }}><span style={{ color: T.accentBlue, fontWeight: 700 }}>{t("programme.regression")}: </span><span style={{ color: T.mutedMid }}>{L(ex.regression)}</span></div>}
          </div>
        )}

        {(ex.variations?.length ?? 0) > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#e4c08c", alignSelf: "center" }}>{t("programme.variations")}:</span>
            {ex.variations.map((v, i) => (
              <button key={i} onClick={() => ask(`${locale === "zh" ? "點樣做" : "How do I do the"} ${L(v.name)}?`, "qa")} disabled={coach.running}
                style={{ ...chip("rgba(255,255,255,0.05)", T.mutedMid), cursor: coach.running ? "default" : "pointer" }}>
                {L(v.name)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* message thread */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ fontSize: 12, color: T.muted, textAlign: "center", marginTop: 24 }}>
            💬 {t("coach.empty")}
          </div>
        )}
        {messages.map((m, i) => m.role === "user" ? (
          <div key={i} style={{ alignSelf: "flex-end", maxWidth: "85%", background: "rgba(196,148,82,0.2)", color: T.text, borderRadius: "12px 12px 2px 12px", padding: "8px 12px", fontSize: 12.5 }}>
            {m.text}
          </div>
        ) : (
          <div key={i} style={{ alignSelf: "flex-start", maxWidth: "92%", background: "rgba(0,0,0,0.22)", borderRadius: "12px 12px 12px 2px", padding: "10px 12px", borderLeft: `2px solid ${T.accent}` }}>
            {m.running && <Spinner emoji="🧠" label={plainThought(coach.thoughts[coach.thoughts.length - 1]) ?? t("common.generating")} />}
            {m.running && coach.thoughts.length > 0 && (
              <div style={{
                marginTop: 8, display: "flex", flexDirection: "column", gap: 4,
                padding: "8px 12px", background: "rgba(0,0,0,0.18)",
                borderRadius: 8, borderLeft: `2px solid ${T.border}`,
                maxHeight: 140, overflowY: "auto",
              }}>
                {coach.thoughts.map((line, k) => (
                  <div key={k} style={{
                    fontSize: 11, color: T.muted, lineHeight: 1.45, fontFamily: T.font.mono,
                    opacity: k === coach.thoughts.length - 1 ? 1 : 0.55,
                  }}>
                    <ThoughtLine line={line} />
                  </div>
                ))}
              </div>
            )}
            {m.running && coach.sources.length > 0 && <div style={{ marginTop: 8 }}><LiveSources sources={coach.sources} /></div>}
            {m.error && <span style={{ color: "#f0a896", fontSize: 11.5 }}>⚠️ {m.error}</span>}
            {!m.running && m.text && <MarkdownSummary text={m.text} />}
            {!m.running && m.videoUrl && <div style={{ marginTop: 8 }}><YouTubeEmbed url={m.videoUrl} /></div>}
            {!m.running && (m.sources?.length ?? 0) > 0 && (
              <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
                {m.sources!.filter((s) => !m.videoUrl || s.url !== m.videoUrl).map((s, j) => (
                  <li key={j} style={{ fontSize: 11, display: "flex", gap: 6 }}>
                    <span style={{ color: "#e4c08c" }}>·</span>
                    {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: T.accent, textDecoration: "underline" }}>{s.title || s.url}</a> : <span>{s.title}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* composer */}
      <div style={{ padding: 12, borderTop: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {chips.map((c) => (
            <button key={c.label} onClick={() => ask(c.q ?? c.label, c.mode)} disabled={coach.running}
              style={{ ...chip("rgba(122,148,140,0.12)", T.accentBlue), cursor: coach.running ? "default" : "pointer" }}>{c.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { ask(q, "qa"); setQ(""); } }}
            placeholder={t("coach.placeholder")} data-testid="coach-input"
            style={{ flex: 1, background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px", color: T.text, fontSize: 12.5, outline: "none" }} />
          <button onClick={() => { ask(q, "qa"); setQ(""); }} disabled={coach.running || !q.trim()}
            style={{ fontSize: 12, padding: "8px 14px", borderRadius: 99, background: "linear-gradient(135deg, rgba(196,148,82,0.95), rgba(140,92,48,0.95))", border: "1px solid rgba(255,252,245,0.25)", color: "#fffdf6", fontWeight: 600, cursor: coach.running || !q.trim() ? "not-allowed" : "pointer", opacity: coach.running || !q.trim() ? 0.6 : 1 }}>
            {t("coach.ask")}
          </button>
        </div>
      </div>
    </div>
  );
}

function chip(bg: string, color: string): React.CSSProperties {
  return { fontSize: 10, padding: "2px 8px", borderRadius: 99, background: bg, color, border: `1px solid ${T.border}`, whiteSpace: "nowrap" };
}
