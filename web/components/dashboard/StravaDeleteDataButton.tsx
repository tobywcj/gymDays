"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";

type Props = {
  clientId: string;
  clientName: string;
  activityCount: number;
  onDeleted?: () => void;
};

export default function StravaDeleteDataButton({ clientId, clientName, activityCount, onDeleted }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmPhrase = "DELETE";
  const canSubmit = typed.trim() === confirmPhrase && !busy;

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  async function run() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/strava/disconnect/${clientId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete_activities: true }),
      });
      if (!r.ok) throw new Error(await r.text());
      setOpen(false);
      setTyped("");
      onDeleted?.();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setTyped("");
    setError(null);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        data-testid="strava-delete-data"
        style={{
          fontSize: 11, padding: "4px 11px", borderRadius: 99,
          border: "1px solid rgba(248,113,113,0.4)", background: "transparent",
          color: "#f87171", cursor: "pointer",
        }}
      >
        Delete Strava data
      </button>

      {open && mounted && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "transparent",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
          }}
        >
          <div
            style={{
              borderRadius: T.radius.card, padding: 28, maxWidth: 460, width: "100%",
              display: "flex", flexDirection: "column", gap: 14,
              background: "#1c2418",
              border: `1px solid ${T.border}`,
              boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
            }}
            data-testid="strava-delete-modal"
          >
            <div>
              <div style={{ fontFamily: T.font.mono, fontSize: 18, color: "#f87171" }}>
                Delete Strava data for {clientName}?
              </div>
              <div style={{ fontSize: 12, color: T.muted, marginTop: 8, lineHeight: 1.55 }}>
                This will permanently delete:
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  <li>The stored Strava OAuth tokens</li>
                  <li>The linked Strava athlete ID</li>
                  <li>
                    <strong>{activityCount}</strong> Strava {activityCount === 1 ? "activity" : "activities"} (heart-rate, distance, suffer-score, all metrics)
                  </li>
                </ul>
                This cannot be undone.
              </div>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11, color: T.muted }}>
              Type <code style={{ color: "#f87171" }}>{confirmPhrase}</code> to confirm:
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
                data-testid="strava-delete-confirm-input"
                style={{
                  background: "rgba(0,0,0,0.25)", border: `1px solid ${T.border}`,
                  borderRadius: 8, padding: "9px 11px",
                  color: T.text, fontFamily: T.font.mono, fontSize: 13, outline: "none",
                }}
              />
            </label>

            {error && (
              <div data-testid="strava-delete-error" style={{ fontSize: 11, color: "#f87171" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
              <button
                onClick={close}
                disabled={busy}
                style={{
                  fontSize: 12, padding: "7px 14px", borderRadius: 99,
                  border: `1px solid ${T.border}`, background: "transparent",
                  color: T.muted, cursor: busy ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={run}
                disabled={!canSubmit}
                data-testid="strava-delete-confirm"
                style={{
                  fontSize: 12, padding: "7px 16px", borderRadius: 99,
                  border: "1px solid #f87171",
                  background: canSubmit ? "#f87171" : "transparent",
                  color: canSubmit ? "#1c2418" : "#f87171",
                  fontWeight: 600,
                  cursor: canSubmit ? "pointer" : "not-allowed",
                  opacity: busy ? 0.7 : 1,
                }}
              >
                {busy ? "⏳ Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
