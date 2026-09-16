"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import InjuryGraph from "./InjuryGraph";

export type InjuryLogEntry = {
  id: string;
  source: "trainer" | "screening" | "onboarding" | "client_report";
  note: string | null;
  created_at: string;
  resolved_at: string | null;   // set → injury closed, excluded from flagging
};

type Props = {
  clientId: string;
  official: string | null;     // clients.injury_history (canonical, app reads this)
  reported: string[];          // client's self-reported injuries from the screening (reference)
  trail: InjuryLogEntry[];     // append-only history, newest first
};

// Distinct, color-coded tag per source so it's unmistakable who entered each row.
const SRC_STYLE: Record<InjuryLogEntry["source"], { icon: string; bg: string; fg: string }> = {
  trainer:       { icon: "🧑‍🏫", bg: "rgba(134,163,120,0.22)", fg: "#a7c39c" }, // moss
  screening:     { icon: "📋",   bg: "rgba(196,148,82,0.20)",  fg: "#e4c08c" }, // ochre — intake questionnaire
  client_report: { icon: "📣",   bg: "rgba(196,108,76,0.22)",  fg: "#e89a7c" }, // clay — portal self-report
  onboarding:    { icon: "🗒️", bg: "rgba(122,148,140,0.22)", fg: "#9fc1ba" }, // blue-sage
};

// Trainer-managed injury status on the pre-screening check. The trainer is the
// only one who can change the official status; the questionnaire self-report is
// shown as reference. Every save appends to an immutable trail (no override).
export default function InjuryStatusCard({ clientId, official, reported, trail }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [note, setNote] = useState(official ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTrail, setShowTrail] = useState(false);
  // Per-entry edit/delete (fix mistakes in the trail).
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  async function saveEntry(entryId: string) {
    setRowBusy(entryId);
    setRowError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/injury/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: editText }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "error");
      setEditId(null);
      router.refresh();
    } catch (e) {
      setRowError((e as Error).message);
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteEntry(entryId: string) {
    setRowBusy(entryId);
    setRowError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/injury/${entryId}`, { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "error");
      router.refresh();
    } catch (e) {
      setRowError((e as Error).message);
    } finally {
      setRowBusy(null);
    }
  }

  async function setResolved(entryId: string, resolved: boolean) {
    setRowBusy(entryId);
    setRowError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/injury/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "error");
      router.refresh();
    } catch (e) {
      setRowError((e as Error).message);
    } finally {
      setRowBusy(null);
    }
  }

  const dirty = note.trim() !== (official ?? "").trim();
  const dateFmt = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "zh" ? "zh-TW" : "en-US", { year: "numeric", month: "short", day: "numeric" });

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/injury`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "error");
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const srcLabel = (s: InjuryLogEntry["source"]) => ({
    trainer: t("injury.srcTrainer"),
    screening: t("injury.srcScreening"),
    client_report: t("injury.srcClient"),
    onboarding: t("injury.srcOnboarding"),
  }[s] ?? s);

  const sourceTag = (s: InjuryLogEntry["source"]) => (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 99,
      background: SRC_STYLE[s].bg, color: SRC_STYLE[s].fg,
      fontWeight: 700, fontSize: 9.5, letterSpacing: "0.04em", textTransform: "uppercase",
    }}>
      {SRC_STYLE[s].icon} {srcLabel(s)}
    </span>
  );

  // Source of the CURRENT official status, mirroring the API recompute: a trainer
  // entry wins; otherwise it's the latest entry (the client's self-report). Lets
  // the trainer see at a glance whether the status is confirmed or un-reviewed.
  const officialSource: InjuryLogEntry["source"] | null = official == null
    ? null
    : (trail.some((e) => e.source === "trainer") ? "trainer" : (trail[0]?.source ?? null));

  return (
    <div className="glass" style={{ borderRadius: T.radius.card, padding: 18, display: "flex", flexDirection: "column", gap: 12 }} data-testid="injury-status-card">
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.muted }}>
        🩼 {t("injury.title")}
      </div>

      {/* Official, trainer-set status */}
      <div>
        <div style={{ fontSize: 10, color: T.muted, marginBottom: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>{t("injury.official")}</span>
          {officialSource && sourceTag(officialSource)}
          {officialSource && officialSource !== "trainer" && <span style={{ color: "#e4c08c" }}>· {t("injury.unreviewed")}</span>}
        </div>
        {official ? (
          <div style={{ fontSize: 13, color: T.text, lineHeight: 1.5 }}>{official}</div>
        ) : (
          <div style={{ fontSize: 12, color: T.muted, fontStyle: "italic" }}>{t("injury.none")}</div>
        )}
      </div>

      {/* node-edge injury timeline: one node per entry, dated, colored by state */}
      <InjuryGraph
        official={official}
        entries={trail.map((e) => ({ note: e.note, resolved: !!e.resolved_at, created_at: e.created_at }))}
      />

      {/* Client self-report (reference only) */}
      {reported.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: T.muted, marginBottom: 5 }}>📝 {t("injury.clientReported")}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {reported.map((r, i) => (
              <span key={i} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 99, background: "rgba(196,148,82,0.14)", color: "#e4c08c" }}>{r}</span>
            ))}
          </div>
        </div>
      )}

      {/* Trainer update form */}
      {!editing ? (
        <button onClick={() => { setNote(official ?? ""); setEditing(true); }} data-testid="injury-edit"
          style={{ alignSelf: "flex-start", fontSize: 11, padding: "6px 12px", borderRadius: 99, background: "rgba(255,252,245,0.12)", border: "1px solid rgba(255,252,245,0.35)", color: "#fffdf6", fontWeight: 600, cursor: "pointer" }}>
          ✎ {t("injury.update")}
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            rows={3} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={t("injury.placeholder")} data-testid="injury-note"
            style={{ width: "100%", boxSizing: "border-box", resize: "vertical", background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px", color: T.text, fontSize: 12.5, fontFamily: T.font.sans, outline: "none" }}
          />
          {reported.length > 0 && (
            <button onClick={() => setNote(reported.join("; "))} type="button"
              style={{ alignSelf: "flex-start", fontSize: 10, color: T.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              ↳ {t("injury.copyReported")}
            </button>
          )}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button onClick={save} disabled={saving || !dirty} data-testid="injury-save"
              style={{ fontSize: 11, padding: "6px 12px", borderRadius: 99, background: "rgba(127,181,110,0.35)", border: "1px solid rgba(127,181,110,0.7)", color: "#fffdf6", fontWeight: 600, cursor: saving || !dirty ? "not-allowed" : "pointer", opacity: saving || !dirty ? 0.6 : 1 }}>
              {saving ? "…" : t("injury.save")}
            </button>
            <button onClick={() => { setEditing(false); setNote(official ?? ""); setError(null); }} disabled={saving}
              style={{ fontSize: 11, padding: "6px 12px", borderRadius: 99, background: "transparent", border: `1px solid ${T.border}`, color: T.mutedMid, cursor: "pointer" }}>
              {t("common.cancel")}
            </button>
          </div>
          {error && <div style={{ fontSize: 10, color: "#f87171", fontFamily: T.font.mono }}>{error}</div>}
        </div>
      )}

      {/* Append-only trail */}
      {trail.length > 0 && (
        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
          <button onClick={() => setShowTrail((s) => !s)} data-testid="injury-trail-toggle"
            style={{ background: "none", border: "none", cursor: "pointer", color: T.mutedMid, fontSize: 11, fontWeight: 600, display: "flex", gap: 5, alignItems: "center", padding: 0 }}>
            {showTrail ? "▾" : "▸"} 🕑 {t("injury.trail")} · {trail.length}
          </button>
          {showTrail && (
            <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
              {trail.map((e) => {
                const resolved = !!e.resolved_at;
                return (
                <li key={e.id} style={{ fontSize: 11, color: T.mutedMid, lineHeight: 1.5, borderLeft: `2px solid ${resolved ? "rgba(134,163,120,0.5)" : T.border}`, paddingLeft: 8, opacity: resolved ? 0.65 : 1 }}>
                  <div style={{ display: "flex", gap: 6, color: T.muted, fontSize: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {sourceTag(e.source)}
                    <span>{dateFmt(e.created_at)}</span>
                    {resolved && <span style={{ padding: "1px 7px", borderRadius: 99, background: "rgba(134,163,120,0.22)", color: "#a7c39c", fontWeight: 700, fontSize: 9 }}>✓ {t("injury.resolvedTag")}</span>}
                    <span style={{ flex: 1 }} />
                    {editId !== e.id && (
                      <>
                        <button onClick={() => setResolved(e.id, !resolved)} disabled={rowBusy === e.id}
                          data-testid="injury-entry-resolve" title={resolved ? t("injury.reopen") : t("injury.resolve")}
                          style={{ background: "none", border: "none", cursor: rowBusy === e.id ? "default" : "pointer", color: resolved ? T.mutedMid : "#a7c39c", fontSize: 10, fontWeight: 600, padding: 0 }}>
                          {rowBusy === e.id ? "…" : (resolved ? t("injury.reopen") : t("injury.resolve"))}
                        </button>
                        <button onClick={() => { setEditId(e.id); setEditText(e.note ?? ""); setRowError(null); }}
                          data-testid="injury-entry-edit" title={t("injury.edit")}
                          style={{ background: "none", border: "none", cursor: "pointer", color: T.accent, fontSize: 11, padding: 0 }}>✎</button>
                        <button onClick={() => deleteEntry(e.id)} disabled={rowBusy === e.id}
                          data-testid="injury-entry-delete" title={t("injury.delete")}
                          style={{ background: "none", border: "none", cursor: rowBusy === e.id ? "default" : "pointer", color: "#e0796a", fontSize: 11, padding: 0 }}>
                          {rowBusy === e.id ? "…" : "🗑"}
                        </button>
                      </>
                    )}
                  </div>
                  {editId === e.id ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 4 }}>
                      <textarea rows={2} value={editText} onChange={(ev) => setEditText(ev.target.value)} data-testid="injury-entry-note"
                        style={{ width: "100%", boxSizing: "border-box", resize: "vertical", background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 8, padding: "6px 8px", color: T.text, fontSize: 12, fontFamily: T.font.sans, outline: "none" }} />
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => saveEntry(e.id)} disabled={rowBusy === e.id} data-testid="injury-entry-save"
                          style={{ fontSize: 10, padding: "4px 10px", borderRadius: 99, background: "rgba(127,181,110,0.35)", border: "1px solid rgba(127,181,110,0.7)", color: "#fffdf6", cursor: "pointer" }}>
                          {rowBusy === e.id ? "…" : t("injury.save")}
                        </button>
                        <button onClick={() => { setEditId(null); setRowError(null); }}
                          style={{ fontSize: 10, padding: "4px 10px", borderRadius: 99, background: "transparent", border: `1px solid ${T.border}`, color: T.mutedMid, cursor: "pointer" }}>
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: T.text, textDecoration: resolved ? "line-through" : "none" }}>{e.note || <em style={{ color: T.muted }}>{t("injury.cleared")}</em>}</div>
                  )}
                  {rowError && rowBusy === null && editId === e.id && <div style={{ fontSize: 10, color: "#f87171" }}>{rowError}</div>}
                </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
