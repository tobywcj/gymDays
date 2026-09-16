"use client";

import { useState } from "react";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";

// The portal's one client-write surface: ask the trainer to change the programme.
// Posts to /api/portal/program-request, which derives trainer_id server-side.
export default function ProgramRequestForm() {
  const { t } = useI18n();
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit() {
    if (!body.trim() || state === "sending") return;
    setState("sending");
    try {
      const r = await fetch("/api/portal/program-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setBody("");
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <section className="glass" style={{ borderRadius: T.radius.card, padding: 18, height: "100%", overflowY: "auto" }}>
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em", marginBottom: 4 }}>
        {t("request.title")}
      </div>
      <div style={{ fontSize: 12, color: T.muted, marginBottom: 10 }}>{t("request.subtitle")}</div>
      <textarea
        value={body}
        onChange={(e) => { setBody(e.target.value); if (state !== "idle") setState("idle"); }}
        placeholder={t("request.placeholder")}
        rows={3}
        maxLength={2000}
        style={{
          width: "100%", boxSizing: "border-box", resize: "vertical",
          background: "rgba(255,252,245,0.05)", border: `1px solid ${T.border}`,
          borderRadius: T.radius.md, padding: "10px 12px", color: T.text, fontSize: 13,
          fontFamily: T.font.sans, outline: "none",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
        <button
          onClick={submit}
          disabled={!body.trim() || state === "sending"}
          style={{
            border: `1px solid ${T.accent}`, background: `${T.accent}1f`,
            borderRadius: T.radius.pill, padding: "7px 16px", color: T.text, fontSize: 12,
            cursor: !body.trim() || state === "sending" ? "default" : "pointer",
            opacity: !body.trim() ? 0.5 : 1,
          }}
        >
          {state === "sending" ? t("request.sending") : t("request.send")}
        </button>
        {state === "sent" && <span style={{ fontSize: 12, color: T.accentMoss }}>{t("request.sent")}</span>}
        {state === "error" && <span style={{ fontSize: 12, color: "#f87171" }}>{t("request.error")}</span>}
      </div>
    </section>
  );
}
