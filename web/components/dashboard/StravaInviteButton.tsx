"use client";

import { useState } from "react";
import { T } from "@/lib/design-tokens";
import Spinner from "./Spinner";

type Props = { clientId: string };

export default function StravaInviteButton({ clientId }: Props) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mint() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const r = await fetch(`/api/strava/invite/${clientId}`, { method: "POST" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `failed: ${r.status}`);
      }
      const { url } = (await r.json()) as { url: string };
      setUrl(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  if (url) {
    return (
      <div
        data-testid="strava-invite-url"
        style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", maxWidth: 320 }}
      >
        <div style={{ fontSize: 10, color: T.muted }}>Send this link to your client:</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", width: "100%" }}>
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              flex: 1, fontSize: 10, padding: "5px 8px", borderRadius: 6,
              border: `1px solid ${T.border}`, background: "rgba(0,0,0,0.25)",
              color: T.text, fontFamily: T.font.mono,
            }}
          />
          <button
            onClick={copy}
            data-testid="strava-invite-copy"
            style={{
              fontSize: 10, padding: "5px 10px", borderRadius: 99,
              border: `1px solid ${T.border}`, background: "transparent",
              color: copied ? T.accent : T.mutedMid, cursor: "pointer",
            }}
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
        <div style={{ fontSize: 9, color: T.muted }}>Expires in 7 days · single use</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button
        onClick={mint}
        disabled={busy}
        data-testid="strava-invite"
        style={{
          fontSize: 12,
          padding: "7px 14px",
          borderRadius: 99,
          background: "transparent",
          color: "#FC4C02",
          border: "1px solid #FC4C02",
          fontWeight: 600,
          cursor: busy ? "not-allowed" : "pointer",
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? <Spinner emoji="🔗" label="Generating…" /> : "Send Strava Invitation"}
      </button>
      {error && (
        <span data-testid="strava-invite-error" style={{ fontSize: 10, color: "#f87171", maxWidth: 200, textAlign: "right" }}>
          {error}
        </span>
      )}
    </div>
  );
}
