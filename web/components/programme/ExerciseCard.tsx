"use client";

import { useState } from "react";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { GROUPS, AFT_BY_KEY, type ExerciseRow, type MuscleRegion, type Lang, type KeyPoints } from "@/lib/exercise-library";
import { SUITABILITY_EMOJI, type Suitability } from "@/lib/exercise-suitability";
import { MUSCLE_LABELS } from "./MuscleMap";
import ExerciseIllustration from "./ExerciseIllustration";
import ExerciseVisual from "./ExerciseVisual";
import { suitabilityLabel } from "./ExerciseChat";
import Spinner from "@/components/dashboard/Spinner";

type Props = {
  ex: ExerciseRow;
  clientId: string | null;
  clientName?: string | null;
  caveat?: Suitability | null;   // stored/computed badge for the in-context client
  caveatLoading?: boolean;       // suitability is being fetched for the in-context client
  caveatError?: boolean;         // suitability data couldn't be loaded (show error, not "suitable")
  readOnly?: boolean;
  flagged: boolean;
  onOpenChat: (autoAsk?: "caveat") => void;   // "caveat" → chat auto-asks why + alternatives
  onToggleFlag?: (id: string, next: boolean) => void;
  onAddToSession?: (ex: ExerciseRow) => void;
  imgProvider?: string;   // selected AI illustration provider (filter card)
};

const chip = (bg: string, color: string): React.CSSProperties => ({
  fontSize: 10, padding: "2px 8px", borderRadius: 99, background: bg, color,
  border: `1px solid ${T.border}`, whiteSpace: "nowrap",
});

export default function ExerciseCard({ ex, clientId, clientName, caveat, caveatLoading, caveatError, readOnly, flagged, onOpenChat, onToggleFlag, onAddToSession, imgProvider }: Props) {
  const { t, locale } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  const [showKp, setShowKp] = useState(false);
  const [showReason, setShowReason] = useState(false);
  const [illoUrl, setIlloUrl] = useState<string | null>(ex.illustrationUrl ?? null);
  const [genBusy, setGenBusy] = useState(false);
  const [genErr, setGenErr] = useState<string | null>(null);

  async function generateIllustration() {
    if (genBusy) return;
    setGenBusy(true);
    setGenErr(null);
    try {
      const r = await fetch(`/api/exercises/${ex.id}/illustration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: imgProvider }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "error");
      setIlloUrl(data.url);
    } catch (e) {
      setGenErr((e as Error).message);
    } finally {
      setGenBusy(false);
    }
  }

  const name = locale === "zh" && ex.name_zh ? ex.name_zh : ex.name;
  // Surface the other language too, so cards read bilingually regardless of toggle.
  const altName = locale === "zh" ? (ex.name && ex.name !== name ? ex.name : null) : (ex.name_zh || null);
  const muscleLabel = (r: MuscleRegion) => (locale === "zh" ? MUSCLE_LABELS[r]?.zh : MUSCLE_LABELS[r]?.en) ?? r;
  // Always show a target muscle group: prefer the specific primary muscles,
  // else fall back to the exercise's muscle_group label so no card is blank.
  const groupFallback = (() => {
    if (!ex.muscle_group) return "";
    const g = GROUPS.find((x) => x.key === ex.muscle_group);
    return g ? (locale === "zh" ? g.label.zh : g.label.en) : ex.muscle_group;
  })();
  const subtitle = (ex.primary_muscles?.length ? ex.primary_muscles.map(muscleLabel).join(" · ") : groupFallback);
  const suit: Suitability | null = clientId ? (caveat ?? null) : null;

  // The AASFP "6 key points" — same ordering/labels as the chat drawer.
  const L = (lang: Lang) => (locale === "zh" ? lang.zh : lang.en);
  const KP: { key: keyof KeyPoints; label: string }[] = [
    { key: "bodyPosition", label: t("kp.bodyPosition") },
    { key: "stabilization", label: t("kp.stabilization") },
    { key: "pathOfMotion", label: t("kp.pathOfMotion") },
    { key: "rangeOfMotion", label: t("kp.rangeOfMotion") },
    { key: "breathing", label: t("kp.breathing") },
    { key: "rhythm", label: t("kp.rhythm") },
  ];

  return (
    <div
      className="glass"
      data-testid="programme-card"
      style={{
        borderRadius: T.radius.card, padding: 14, display: "flex", flexDirection: "column", gap: 10,
        opacity: flagged ? 0.6 : 1, borderLeft: flagged ? `3px solid ${T.muted}` : undefined,
      }}
    >
      {/* primary visual = target muscle group (AI movement illustration if available) — clicking opens the chat */}
      <button onClick={() => onOpenChat()} data-testid="open-chat"
        style={{ background: "rgba(0,0,0,0.18)", border: "none", borderRadius: 14, padding: "10px 8px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <ExerciseIllustration ex={{ ...ex, illustrationUrl: illoUrl }} size={120} />
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em", textAlign: "center", color: T.text }}>{name}</div>
        {altName && <div style={{ fontSize: 10.5, color: T.mutedMid, textAlign: "center", marginTop: -2 }}>{altName}</div>}
        <div style={{ fontSize: 11, color: T.muted, textAlign: "center" }}>{subtitle}</div>
      </button>

      {/* AI illustration generation (trainer view) — uses the provider chosen in the filter card */}
      {!readOnly && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <button onClick={generateIllustration} disabled={genBusy} data-testid="generate-illustration"
            style={{
              background: "none", border: "none", cursor: genBusy ? "default" : "pointer",
              color: genBusy ? T.muted : T.accent, fontSize: 11, fontWeight: 600,
              display: "flex", gap: 5, alignItems: "center", padding: 0, alignSelf: "flex-start",
            }}>
            {genBusy ? "⏳" : "✨"} {illoUrl ? t("illo.regenerate") : t("illo.generate")}
          </button>
          {genErr && <span style={{ fontSize: 10, color: "#f0a896", fontFamily: T.font.mono }}>{genErr}</span>}
        </div>
      )}

      {/* gym demonstration photo — collapsed by default */}
      {ex.imageUrl && (
        <div>
          <button onClick={() => setShowPhoto((s) => !s)} data-testid="toggle-demo-photo"
            style={{ background: "none", border: "none", cursor: "pointer", color: T.mutedMid, fontSize: 11, fontWeight: 600, display: "flex", gap: 5, alignItems: "center", padding: 0 }}>
            {showPhoto ? "▾" : "▸"} 📷 {t("programme.demoPhoto")}
          </button>
          {showPhoto && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
              <ExerciseVisual ex={ex} size={180} />
            </div>
          )}
        </div>
      )}

      {/* AASFP 6 key points — collapsed by default */}
      {ex.key_points && (
        <div>
          <button onClick={() => setShowKp((s) => !s)} data-testid="toggle-key-points"
            style={{ background: "none", border: "none", cursor: "pointer", color: T.mutedMid, fontSize: 11, fontWeight: 600, display: "flex", gap: 5, alignItems: "center", padding: 0 }}>
            {showKp ? "▾" : "▸"} 📋 {t("programme.keyPoints")}
          </button>
          {showKp && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
              {KP.map(({ key, label }) => (
                <div key={key} style={{ fontSize: 11, lineHeight: 1.5 }}>
                  <span style={{ color: "#e4c08c", fontWeight: 700 }}>{label}: </span>
                  <span style={{ color: T.mutedMid }}>{L(ex.key_points![key])}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {ex.aft_level && (
          <span
            title={locale === "zh" ? AFT_BY_KEY[ex.aft_level].who.zh : AFT_BY_KEY[ex.aft_level].who.en}
            style={{ ...chip(`${AFT_BY_KEY[ex.aft_level].color}26`, AFT_BY_KEY[ex.aft_level].color), display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 99, background: AFT_BY_KEY[ex.aft_level].color }} />
            {locale === "zh" ? AFT_BY_KEY[ex.aft_level].label.zh : AFT_BY_KEY[ex.aft_level].label.en}
          </span>
        )}
        {(ex.equipment_options?.length ? ex.equipment_options : [ex.equipment].filter(Boolean) as string[]).map((eq) => (
          <span key={eq} style={chip("rgba(255,255,255,0.05)", T.mutedMid)}>{t(`equip.${eq}`)}</span>
        ))}
        {ex.tempo && <span style={chip("rgba(122,148,140,0.16)", T.accentBlue)}>🫁 {t("programme.breathTempo")} {ex.tempo}</span>}
      </div>

      {/* suitability is loading for the in-context client — show a placeholder badge so the card isn't silently blank */}
      {clientId && !caveatError && caveatLoading && !suit && (
        <div data-testid="caveat-loading"
          style={{ ...chip("rgba(255,255,255,0.05)", T.mutedMid), alignSelf: "flex-start", fontSize: 11, padding: "4px 10px", display: "flex", gap: 6, alignItems: "center" }}>
          <Spinner emoji="⏳" label={t("caveat.loading")} />
        </div>
      )}

      {/* suitability data failed to load — show an explicit error, never a misleading ✅ */}
      {clientId && caveatError && (
        <div data-testid="caveat-error"
          style={{ ...chip("rgba(196,76,60,0.2)", T.text), alignSelf: "flex-start", fontSize: 11, padding: "4px 10px", display: "flex", gap: 6, alignItems: "center" }}
          title={t("caveat.errorHint")}>
          <span>⚠️ {t("caveat.error")}</span>
        </div>
      )}

      {/* caveat badge — "Suitable for [client]"; tap to reveal the reason(s) */}
      {!caveatError && suit && (() => {
        const accent = suit.level === "avoid" ? "#e0796a" : suit.level === "caution" ? "#e4c08c" : "#a7c39c";
        const hasReasons = suit.reasons.length > 0;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              onClick={() => (hasReasons ? setShowReason((s) => !s) : onOpenChat())}
              data-testid="caveat-badge"
              title={suit.reasons.join(" ")}
              style={{
                ...chip(suit.level === "avoid" ? "rgba(196,76,60,0.2)" : suit.level === "caution" ? "rgba(196,148,82,0.2)" : "rgba(134,163,120,0.2)", T.text),
                cursor: "pointer", alignSelf: "flex-start", fontSize: 11, padding: "4px 10px",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <span>{suitabilityLabel(suit.level, clientName, t, locale)}</span>
              {hasReasons && (
                <span style={{ fontSize: 9.5, opacity: 0.85, color: accent }}>
                  · {showReason ? t("caveat.hideReason") : t("caveat.clickReason")}
                </span>
              )}
            </button>
            {showReason && hasReasons && (
              <div data-testid="caveat-reasons" style={{ background: "rgba(0,0,0,0.22)", borderRadius: 8, padding: "8px 10px", borderLeft: `2px solid ${accent}` }}>
                <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                  {suit.reasons.map((r, i) => (
                    <li key={i} style={{ fontSize: 11, color: T.mutedMid, display: "flex", gap: 6, lineHeight: 1.45 }}>
                      <span style={{ flexShrink: 0 }}>{SUITABILITY_EMOJI[suit.level]}</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
                <button onClick={() => onOpenChat("caveat")} data-testid="caveat-why-alt"
                  style={{ marginTop: 8, fontSize: 11, color: T.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  💬 {t("coach.whyAlt")} →
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* primary action → chat */}
      <button onClick={() => onOpenChat()} data-testid="ask-coach"
        style={{ fontSize: 12, padding: "8px 12px", borderRadius: 10, background: "rgba(196,148,82,0.14)", border: `1px solid rgba(196,148,82,0.4)`, color: "#e4c08c", fontWeight: 600, cursor: "pointer" }}>
        💬 {t("coach.askCoach")}
      </button>

      {/* footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
        <span style={{ fontSize: 10, color: T.muted }}>
          {ex.citation ? `${ex.citation.doc} · p.${ex.citation.page}` : ex.source === "core" ? t("programme.coreSource") : ""}
        </span>
        {!readOnly && (
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => onAddToSession?.(ex)} data-testid="add-to-session" style={{ ...chip("rgba(134,163,120,0.16)", T.accentMoss), cursor: "pointer" }}>＋ {t("session.add")}</button>
            {flagged ? (
              <button onClick={() => onToggleFlag?.(ex.id, false)} data-testid="restore-exercise" style={{ ...chip("rgba(255,255,255,0.05)", T.mutedMid), cursor: "pointer" }}>↺ {t("programme.restore")}</button>
            ) : confirming ? (
              <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <span style={{ fontSize: 10, color: T.muted }}>{t("programme.confirmFlag")}</span>
                <button onClick={() => { onToggleFlag?.(ex.id, true); setConfirming(false); }} style={{ ...chip("rgba(196,76,60,0.2)", "#f0a896"), cursor: "pointer" }}>{t("common.confirm")}</button>
                <button onClick={() => setConfirming(false)} style={{ ...chip("rgba(255,255,255,0.05)", T.mutedMid), cursor: "pointer" }}>{t("common.cancel")}</button>
              </span>
            ) : (
              <button onClick={() => setConfirming(true)} data-testid="flag-exercise" style={{ ...chip("rgba(255,255,255,0.04)", T.muted), cursor: "pointer" }}>⚑ {t("programme.notRecommended")}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
