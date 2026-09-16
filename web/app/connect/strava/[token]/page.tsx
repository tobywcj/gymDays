import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { T } from "@/lib/design-tokens";
import PublicStravaConnect from "./PublicStravaConnect";
import PoweredByStrava from "@/components/strava/PoweredByStrava";

async function anonClient() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return store.getAll(); },
        setAll() {},
      },
    },
  );
}

type LookupRow = { client_id: string; client_name: string; trainer_name: string | null; expires_at: string };

type Props = { params: Promise<{ token: string }> };

export default async function StravaConnectPage({ params }: Props) {
  const { token } = await params;
  const supabase = await anonClient();
  const { data } = await supabase
    .rpc("strava_connect_lookup", { p_token: token });
  const rows = data as unknown as LookupRow[] | null;
  const row = rows?.[0];

  const publicClientId = process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID;

  if (!row || !publicClientId) {
    return (
      <div style={shellStyle}>
        <div className="glass" data-testid="strava-connect-expired" style={cardStyle}>
          <div style={{ fontFamily: T.font.mono, fontSize: 22, marginBottom: 6 }}>410</div>
          <div style={{ fontSize: 13, color: T.mutedMid }}>
            {publicClientId ? "This connect link is expired, used, or invalid." : "Strava is not configured for this environment."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={shellStyle}>
      <div
        className="glass glass-tint-moss"
        style={{ borderRadius: T.radius.card, padding: 32, maxWidth: 480, width: "100%", display: "flex", flexDirection: "column", gap: 18 }}
      >
        <div>
          <div style={{ fontFamily: T.font.mono, fontSize: 22 }}>Hi {row.client_name},</div>
          <div style={{ fontSize: 13, color: T.muted, marginTop: 6, lineHeight: 1.5 }}>
            {row.trainer_name ? `${row.trainer_name} uses gymDays` : "Your coach uses gymDays"} to plan your training. Connect Strava so your workouts show up automatically — heart rate, distance, suffer score, all of it.
          </div>
        </div>
        <ul style={{ fontSize: 12, color: T.muted, margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>You'll log in to <strong>your own</strong> Strava account.</li>
          <li>gymDays only reads activities — never posts.</li>
          <li>You can disconnect at any time from strava.com.</li>
        </ul>
        <PublicStravaConnect token={token} publicClientId={publicClientId} />
        <PoweredByStrava height={12} align="left" />
      </div>
    </div>
  );
}

const shellStyle = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
} as const;

const cardStyle = { borderRadius: T.radius.card, padding: 32, maxWidth: 420, textAlign: "center" } as const;
