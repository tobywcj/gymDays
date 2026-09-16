"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import InjuryGraph from "@/components/dashboard/InjuryGraph";

export type PortalInjuryEntry = {
  note: string | null;
  source: string;
  created_at: string;
  resolved_at: string | null;
};

type Props = {
  official: string | null;
  entries: PortalInjuryEntry[];
};

// Client-facing injury card: read-only status + node-edge timeline, plus a box
// for the client to report a new injury/niggle. Reports are logged for the
// trainer to confirm — they don't change the official status (trainer authority).
export default function PortalInjuryCard({ official, entries }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const dateFmt = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "zh" ? "zh-TW" : "en-US", { month: "short", day: "numeric" });

  async function report() {
    if (!note.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/portal/injury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "error");
      setNote("");
      setSent(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="glass" style={{ borderRadius: T.radius.card, padding: 20, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em", marginBottom: 12, flexShrink: 0 }}>{t("portal.injury")}</div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>

      {official ? (
        <div style={{ fontSize: 13, color: T.text, lineHeight: 1.5, marginBottom: 10 }}>⚠️ {official}</div>
      ) : (
        <div style={{ fontSize: 12, color: T.muted, marginBottom: 10 }}>{t("portal.injuryNone")}</div>
      )}

      {entries.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <InjuryGraph
            official={official}
            entries={entries.map((e) => ({ note: e.note, resolved: !!e.resolved_at, created_at: e.created_at }))}
          />
        </div>
      )}

      {/* client self-report box */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 11, color: T.mutedMid }}>{t("portal.injuryReportHint")}</div>
        <textarea
          rows={2} value={note} onChange={(e) => { setNote(e.target.value); setSent(false); }}
          placeholder={t("portal.injuryReportPlaceholder")} data-testid="portal-injury-note"
          style={{ width: "100%", boxSizing: "border-box", resize: "vertical", background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px", color: T.text, fontSize: 12.5, fontFamily: T.font.sans, outline: "none" }}
        />
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={report} disabled={saving || !note.trim()} data-testid="portal-injury-report"
            style={{ fontSize: 12, padding: "7px 14px", borderRadius: 99, background: "linear-gradient(135deg, rgba(196,148,82,0.95), rgba(140,92,48,0.95))", border: "1px solid rgba(255,252,245,0.25)", color: "#fffdf6", fontWeight: 600, cursor: saving || !note.trim() ? "not-allowed" : "pointer", opacity: saving || !note.trim() ? 0.6 : 1 }}>
            {saving ? "…" : t("portal.injuryReport")}
          </button>
          {sent && <span style={{ fontSize: 11, color: "#a7c39c" }}>✓ {t("portal.injurySent")}</span>}
          {error && <span style={{ fontSize: 11, color: "#f0a896", fontFamily: T.font.mono }}>{error}</span>}
        </div>
      </div>

      {entries.length > 0 && (
        <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
          {entries.slice(0, 4).map((e, i) => (
            <li key={i} style={{ fontSize: 11, color: T.muted, display: "flex", gap: 8, lineHeight: 1.5 }}>
              <span style={{ whiteSpace: "nowrap", color: T.mutedMid }}>{dateFmt(e.created_at)}</span>
              <span style={{ textDecoration: e.resolved_at ? "line-through" : "none" }}>{e.note || "—"}</span>
            </li>
          ))}
        </ul>
      )}
      </div>
    </section>
  );
}
