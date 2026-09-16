"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Spinner from "./Spinner";

type Props = { clientId: string; onConnected?: () => void };

const AUTH_URL = "https://www.strava.com/oauth/authorize";

export default function StravaConnectButton({ clientId, onConnected }: Props) {
  const publicClientId = process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!publicClientId) return null;

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      // 1) Server stashes a state cookie + verifies ownership.
      const r = await fetch(`/api/strava/prepare/${clientId}`, { method: "POST" });
      if (!r.ok) throw new Error(`prepare failed: ${r.status}`);
      const { state } = (await r.json()) as { state: string };

      // 2) Build the authorize URL in the browser.
      const redirectUri = `${window.location.origin}/api/strava/callback`;
      const url = new URL(AUTH_URL);
      url.searchParams.set("client_id", publicClientId!);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", redirectUri);
      // force re-prompt so a different account can be chosen each time
      url.searchParams.set("approval_prompt", "force");
      url.searchParams.set("scope", "read,activity:read_all");
      url.searchParams.set("state", state);

      // 3) Open Strava in a popup window.
      const w = 600, h = 720;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top  = window.screenY + (window.outerHeight - h) / 2;
      const popup = window.open(
        url.toString(),
        "strava_oauth",
        `popup,width=${w},height=${h},left=${left},top=${top}`,
      );

      if (!popup) {
        // Popup blocked → fall back to full-page redirect.
        window.location.href = url.toString();
        return;
      }

      // 4) Wait for the callback page to postMessage back.
      let receivedOk = false;
      const onMessage = (ev: MessageEvent) => {
        if (ev.origin !== window.location.origin) return;
        const data = ev.data as { type?: string; ok?: boolean; error?: string };
        if (data?.type !== "strava-oauth") return;
        window.removeEventListener("message", onMessage);
        clearInterval(poll);
        setBusy(false);
        if (data.ok) {
          receivedOk = true;
          onConnected?.();
          router.refresh();
        } else {
          setError(data.error ?? "connection failed");
        }
      };
      window.addEventListener("message", onMessage);

      // Safety net: detect a manually-closed popup.
      const poll = setInterval(() => {
        if (popup.closed) {
          clearInterval(poll);
          window.removeEventListener("message", onMessage);
          setBusy(false);
          if (!receivedOk) router.refresh();
        }
      }, 800);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button
        onClick={connect}
        disabled={busy}
        data-testid="strava-connect"
        style={{
          fontSize: 12,
          padding: "7px 14px",
          borderRadius: 99,
          background: "#FC4C02",
          color: "#fff",
          border: "none",
          fontWeight: 600,
          cursor: busy ? "not-allowed" : "pointer",
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? <Spinner emoji="🔗" label="Connecting…" /> : "Connect Strava"}
      </button>
      {error && (
        <span data-testid="strava-connect-error" style={{ fontSize: 10, color: "#f87171", maxWidth: 200, textAlign: "right" }}>
          {error}
        </span>
      )}
    </div>
  );
}
