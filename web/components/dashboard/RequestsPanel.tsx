"use client";

import { useState } from "react";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { relativeTime } from "@/lib/relative-time";

type Req = {
  id: string;
  body: string;
  status: "pending" | "approved" | "declined";
  trainer_note: string | null;
  created_at: string;
  resolved_at: string | null;
};

const STATUS_COLOR: Record<Req["status"], string> = {
  pending: "#d9a441",
  approved: "#86a378",
  declined: "rgba(244,237,226,0.42)",
};

export default function RequestsPanel({ initial }: { initial: Req[] }) {
  const { t, locale } = useI18n();
  const [reqs, setReqs] = useState<Req[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function resolve(id: string, status: "approved" | "declined") {
    setBusy(id);
    try {
      const r = await fetch(`/api/program-request/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setReqs((cur) => cur.map((x) => (x.id === id ? { ...x, status, resolved_at: new Date().toISOString() } : x)));
    } catch {
      /* leave as-is on error */
    } finally {
      setBusy(null);
    }
  }

  const pendingCount = reqs.filter((x) => x.status === "pending").length;

  return (
    <section className="glass" style={{ borderRadius: T.radius.card, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em" }}>📨 {t("request.trainerTitle")}</span>
        {pendingCount > 0 && (
          <span style={{
            fontSize: 11, fontWeight: 700, color: "#1a1a1a", background: STATUS_COLOR.pending,
            borderRadius: T.radius.pill, padding: "1px 8px",
          }}>{pendingCount}</span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {reqs.map((rq) => (
          <div key={rq.id} style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontSize: 13, color: T.text, lineHeight: 1.5, minWidth: 0 }}>{rq.body}</div>
              <span style={{ fontSize: 10, color: STATUS_COLOR[rq.status], whiteSpace: "nowrap", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {t(`request.status.${rq.status}`)}
              </span>
            </div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>{relativeTime(locale, rq.created_at)}</div>
            {rq.status === "pending" && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => resolve(rq.id, "approved")}
                  disabled={busy === rq.id}
                  style={{
                    border: "1px solid #86a378", background: "rgba(134,163,120,0.18)",
                    borderRadius: T.radius.pill, padding: "5px 14px", color: T.text, fontSize: 12,
                    cursor: busy === rq.id ? "default" : "pointer",
                  }}
                >{t("request.approve")}</button>
                <button
                  onClick={() => resolve(rq.id, "declined")}
                  disabled={busy === rq.id}
                  style={{
                    border: `1px solid ${T.border}`, background: "transparent",
                    borderRadius: T.radius.pill, padding: "5px 14px", color: T.mutedMid, fontSize: 12,
                    cursor: busy === rq.id ? "default" : "pointer",
                  }}
                >{t("request.decline")}</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
