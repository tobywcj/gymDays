"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";
import StravaLogo from "./StravaLogo";
import StravaInviteButton from "./StravaInviteButton";
import PoweredByStrava from "@/components/strava/PoweredByStrava";
import Spinner from "./Spinner";

type Activity = {
  id: string;
  source: string;
  external_id: string;
  started_at: string;
  type: string | null;
  distance_m: number | null;
  duration_s: number | null;
  metrics: Record<string, unknown> | null;
};

type Props = {
  clientId: string;
  connected: boolean;
  athleteId: string | null;
  activities: Activity[];
  stravaConfigured: boolean;   // STRAVA_CLIENT_ID set server-side?
};

export default function StravaPanel({ clientId, connected, athleteId, activities, stravaConfigured }: Props) {
  const router = useRouter();
  const [seeding, setSeeding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  async function seed() {
    setSeeding(true);
    try {
      const r = await fetch(`/api/strava/dev-seed/${clientId}`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      router.refresh();
    } finally {
      setSeeding(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await fetch(`/api/strava/sync/${clientId}?per_page=20`, { method: "POST" });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`${r.status}: ${t}`);
      }
      const j = (await r.json()) as { pulled: number };
      setSyncMsg(`Pulled ${j.pulled} activit${j.pulled === 1 ? "y" : "ies"}.`);
      router.refresh();
    } catch (e) {
      setSyncMsg((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const [disconnecting, setDisconnecting] = useState(false);
  const [justDisconnected, setJustDisconnected] = useState(false);
  async function disconnect() {
    if (!confirm("Disconnect Strava? Stored tokens will be removed; activities stay.")) return;
    setDisconnecting(true);
    try {
      const r = await fetch(`/api/strava/disconnect/${clientId}`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      setJustDisconnected(true);
      router.refresh();
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="glass" data-testid="strava-panel" style={{ borderRadius: T.radius.card, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <StravaLogo size={26} />
        <div style={{ flex: "1 1 160px", minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Strava</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
            {connected
              ? <span data-testid="strava-connected">Connected · athlete {athleteId}</span>
              : <span data-testid="strava-not-connected">Not connected</span>}
          </div>
        </div>
        {connected && (
          <>
            <button
              onClick={syncNow}
              disabled={syncing}
              data-testid="strava-sync-now"
              style={{
                fontSize: 12,
                padding: "7px 14px",
                borderRadius: 99,
                border: `1px solid ${T.border}`,
                background: "transparent",
                color: T.accent,
                cursor: syncing ? "not-allowed" : "pointer",
                opacity: syncing ? 0.7 : 1,
              }}
            >
              {syncing ? <Spinner emoji="🏃" label="Syncing…" /> : "Sync now"}
            </button>
            <button
              onClick={disconnect}
              disabled={disconnecting}
              data-testid="strava-disconnect"
              style={{
                fontSize: 12,
                padding: "7px 14px",
                borderRadius: 99,
                border: `1px solid ${T.border}`,
                background: "transparent",
                color: T.mutedMid,
                cursor: disconnecting ? "not-allowed" : "pointer",
                opacity: disconnecting ? 0.7 : 1,
              }}
            >
              {disconnecting ? "…" : "Disconnect"}
            </button>
          </>
        )}
        {!connected && stravaConfigured && (
          <StravaInviteButton clientId={clientId} />
        )}
        {justDisconnected && !connected && (
          <span data-testid="strava-disconnected-tip" style={{ fontSize: 11, color: T.muted, maxWidth: 260, lineHeight: 1.4 }}>
            Disconnected. To use a different Strava account, sign out at
            {" "}<a href="https://www.strava.com/" target="_blank" rel="noreferrer" style={{ color: T.accent }}>strava.com</a>{" "}
            first (or open the next Connect link in an incognito window).
          </span>
        )}
        {!stravaConfigured && (
          <button
            onClick={seed}
            disabled={seeding}
            data-testid="seed-activities"
            style={{
              fontSize: 12,
              padding: "7px 14px",
              borderRadius: 99,
              border: `1px solid ${T.border}`,
              background: "transparent",
              color: T.accent,
              cursor: seeding ? "not-allowed" : "pointer",
            }}
          >
            {seeding ? <Spinner emoji="🌱" label="Seeding…" /> : "Seed dev activities"}
          </button>
        )}
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
        Recent activities <span style={{ color: T.muted, fontWeight: 400 }}>({activities.length})</span>
        {syncMsg && (
          <span data-testid="sync-msg" style={{ marginLeft: "auto", fontSize: 11, fontWeight: 400, color: T.mutedMid }}>
            {syncMsg}
          </span>
        )}
      </div>

      {activities.length === 0 ? (
        <div style={{ fontSize: 12, color: T.muted }}>
          {connected
            ? "No activities ingested yet."
            : stravaConfigured
              ? "Connect Strava to start ingesting."
              : "STRAVA_CLIENT_ID is not set — use “Seed dev activities” to populate this list locally."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
          {activities.map((a) => (
            <div
              key={a.id}
              data-testid="activity-row"
              style={{
                display: "grid",
                gridTemplateColumns: "70px 1fr 60px 70px",
                gap: 8,
                alignItems: "center",
                padding: "8px 10px",
                background: "rgba(0,0,0,0.18)",
                borderRadius: 8,
              }}
            >
              <span style={{ fontSize: 10, color: T.muted, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                {a.type ?? "—"}
              </span>
              <span style={{ fontSize: 12, color: T.mutedMid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {(a.metrics?.name as string) ?? new Date(a.started_at).toLocaleString()}
              </span>
              <span style={{ fontSize: 11, color: T.muted, textAlign: "right" }}>
                {a.distance_m != null ? `${(a.distance_m / 1000).toFixed(1)} km` : "—"}
              </span>
              <span style={{ fontSize: 11, color: T.muted, textAlign: "right" }}>
                {a.duration_s != null ? fmtDuration(a.duration_s) : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
      <PoweredByStrava height={12} align="right" />
    </div>
  );
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
