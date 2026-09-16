"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";

type Props = {
  clientId: string;
  endpoint: "clearance" | "unblock";
  buttonLabel: string;
  successLabel: string;
  placeholder: string;
  testId: string;
};

// Compact inline form for trainer acknowledgements on the screening
// clearance / training-blocked banners. Posts {note} to the API route,
// which calls the corresponding RPC + writes a memory row.
export default function AlertActionForm({
  clientId, endpoint, buttonLabel, successLabel, placeholder, testId,
}: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={testId}
        style={{
          fontSize: 11,
          padding: "6px 12px",
          borderRadius: 99,
          background: "rgba(255, 252, 245, 0.12)",
          border: "1px solid rgba(255, 252, 245, 0.35)",
          color: "#fffdf6",
          fontWeight: 600,
          cursor: "pointer",
          marginTop: 8,
        }}
      >
        {buttonLabel}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      <textarea
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={placeholder}
        data-testid={`${testId}-note`}
        style={{
          background: "rgba(0,0,0,0.35)",
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          padding: "8px 10px",
          color: T.text,
          fontSize: 11,
          outline: "none",
          resize: "vertical",
        }}
      />
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          data-testid={`${testId}-submit`}
          style={{
            fontSize: 11,
            padding: "6px 12px",
            borderRadius: 99,
            background: "rgba(127, 181, 110, 0.35)",
            border: "1px solid rgba(127, 181, 110, 0.7)",
            color: "#fffdf6",
            fontWeight: 600,
            cursor: submitting ? "not-allowed" : "pointer",
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? "…" : successLabel}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setNote(""); setError(null); }}
          disabled={submitting}
          style={{
            fontSize: 11,
            padding: "6px 12px",
            borderRadius: 99,
            background: "transparent",
            border: `1px solid ${T.border}`,
            color: T.mutedMid,
            cursor: "pointer",
          }}
        >
          {t("common.cancel")}
        </button>
      </div>
      {error && <div style={{ fontSize: 10, color: "#f87171" }}>{error}</div>}
    </div>
  );
}
