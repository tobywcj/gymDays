"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import type { ExerciseRow } from "@/lib/exercise-library";

export type SessionItem = { ex: ExerciseRow; sets: string; reps: string; notes: string };

type Props = {
  items: SessionItem[];
  setItems: (fn: (prev: SessionItem[]) => SessionItem[]) => void;
  clients: { id: string; name: string }[];
  clientId: string | null;
};

export default function SessionBuilder({ items, setItems, clients, clientId }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("60");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const clientName = clients.find((c) => c.id === clientId)?.name;

  function update(i: number, patch: Partial<SessionItem>) {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  }
  function remove(i: number) {
    setItems((prev) => prev.filter((_, j) => j !== i));
  }
  function move(i: number, dir: -1 | 1) {
    setItems((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    setMsg(null);
    if (!clientId) { setMsg(t("session.needClient")); return; }
    if (!when) { setMsg(t("session.needDate")); return; }
    if (items.length === 0) { setMsg(t("session.needExercise")); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          scheduled_at: new Date(when).toISOString(),
          duration_min: duration ? Number(duration) : null,
          title: title || null,
          focus: null,
          exercises: items.map((it, i) => ({
            exercise_id: it.ex.id, sets: it.sets, reps: it.reps, notes: it.notes, order: i,
          })),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
      setItems(() => []);
      setTitle(""); setWhen("");
      setMsg(t("session.saved"));
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 8,
    padding: "6px 8px", color: T.text, fontSize: 12, outline: "none",
  };

  return (
    <div className="glass" data-testid="session-builder"
      style={{ borderRadius: T.radius.card, padding: 16, position: "sticky", top: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>🗓️ {t("session.builderTitle")}</div>
      <div style={{ fontSize: 11, color: T.muted }}>
        {clientName ? <>{t("session.for")} <strong style={{ color: T.mutedMid }}>{clientName}</strong></> : t("session.pickClientHint")}
      </div>

      {items.length === 0 && <div style={{ fontSize: 11.5, color: T.muted }}>{t("session.empty")}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
        {items.map((it, i) => (
          <div key={it.ex.id} style={{ background: "rgba(0,0,0,0.18)", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{locale === "zh" && it.ex.name_zh ? it.ex.name_zh : it.ex.name}</span>
              <span style={{ display: "flex", gap: 4 }}>
                <button onClick={() => move(i, -1)} style={miniBtn}>↑</button>
                <button onClick={() => move(i, 1)} style={miniBtn}>↓</button>
                <button onClick={() => remove(i)} style={{ ...miniBtn, color: "#f0a896" }}>✕</button>
              </span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={it.sets} onChange={(e) => update(i, { sets: e.target.value })} placeholder={t("session.sets")} style={{ ...inputStyle, width: 56 }} />
              <input value={it.reps} onChange={(e) => update(i, { reps: e.target.value })} placeholder={t("session.reps")} style={{ ...inputStyle, width: 64 }} />
              <input value={it.notes} onChange={(e) => update(i, { notes: e.target.value })} placeholder={t("session.notes")} style={{ ...inputStyle, flex: 1 }} />
            </div>
          </div>
        ))}
      </div>

      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("session.titlePlaceholder")} style={inputStyle} />
      <div style={{ display: "flex", gap: 6 }}>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} data-testid="session-datetime" style={{ ...inputStyle, flex: 1 }} />
        <input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder={t("session.duration")} style={{ ...inputStyle, width: 64 }} />
      </div>

      {msg && <div style={{ fontSize: 11, color: msg === t("session.saved") ? T.accentMoss : "#f0a896" }}>{msg}</div>}

      <button onClick={save} disabled={saving} data-testid="session-save"
        style={{ fontSize: 12, padding: "8px 14px", borderRadius: 99, background: "linear-gradient(135deg, rgba(196,148,82,0.95), rgba(140,92,48,0.95))", border: "1px solid rgba(255,252,245,0.25)", color: "#fffdf6", fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
        {saving ? t("common.generating") : `${t("session.save")} (${items.length})`}
      </button>
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)", border: `1px solid ${T.border}`, borderRadius: 6,
  color: T.mutedMid, fontSize: 11, cursor: "pointer", padding: "1px 6px",
};
