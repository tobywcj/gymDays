"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConnectWithStravaButton from "@/components/strava/ConnectWithStravaButton";

const AUTH_URL = "https://www.strava.com/oauth/authorize";

type Props = { token: string; publicClientId: string };

export default function PublicStravaConnect({ token, publicClientId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      // Validate + consume token server-side, then mint OAuth state cookies.
      const r = await fetch(`/api/strava/prepare-public/${token}`, { method: "POST" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `prepare failed: ${r.status}`);
      }
      const { state } = (await r.json()) as { state: string };

      const redirectUri = `${window.location.origin}/api/strava/callback`;
      const url = new URL(AUTH_URL);
      url.searchParams.set("client_id", publicClientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", redirectUri);
      // "force" always shows the consent screen — a client who previously
      // declined activity access would otherwise get a scopeless token silently
      // re-issued, leaving sync stuck on 403 with no way to re-grant.
      url.searchParams.set("approval_prompt", "force");
      url.searchParams.set("scope", "read,activity:read_all");
      url.searchParams.set("state", state);

      // Public flow → full-page redirect (clients are typically on mobile,
      // where popups are unreliable). The callback will navigate to the
      // /connect/strava/done thank-you page.
      window.location.href = url.toString();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <ConnectWithStravaButton
        onClick={connect}
        busy={busy}
        testId="strava-public-connect"
        height={48}
      />
      {error && (
        <span data-testid="strava-public-connect-error" style={{ fontSize: 11, color: "#f87171" }}>
          {error}
        </span>
      )}
    </div>
  );
}
