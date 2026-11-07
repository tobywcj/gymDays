// Strava integration helpers (Next.js side).
// Docs: https://developers.strava.com/docs/reference/

const AUTH_URL    = "https://www.strava.com/oauth/authorize";
const TOKEN_URL   = "https://www.strava.com/oauth/token";
const ACTIVITY_URL = (id: string | number) => `https://www.strava.com/api/v3/activities/${id}`;
const STREAMS_URL  = (id: string | number) => `https://www.strava.com/api/v3/activities/${id}/streams`;

export const STRAVA_CLIENT_ID     = process.env.STRAVA_CLIENT_ID || "";
export const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET || "";
export const STRAVA_VERIFY_TOKEN  = process.env.STRAVA_VERIFY_TOKEN || "";

// Scope we need: `activity:read_all` lets us pull the athlete's activities.
// Without it the connection still yields a token + athlete id (so the client
// looks "connected"), but every activities call 403s.
export const STRAVA_SCOPE = "read,activity:read_all";

// True if the scope string Strava granted (returned on the OAuth callback)
// actually includes activity read access.
export function hasActivityScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  const parts = scope.split(",").map((s) => s.trim());
  return parts.includes("activity:read_all") || parts.includes("activity:read");
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: STRAVA_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    // "force" always shows the consent screen. With "auto", a client who
    // previously declined activity access gets a scopeless token re-issued
    // silently, so reconnecting can never recover the missing permission.
    approval_prompt: "force",
    scope: STRAVA_SCOPE,
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

export type StravaTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname?: string; lastname?: string };
};

// `clientSecret` overrides the env secret — callers pass the trainer's
// UI-managed STRAVA_CLIENT_SECRET (from trainer_secrets) so the app secret can
// be rotated in-app without redeploying. Falls back to env when omitted.
export async function exchangeCode(code: string, clientSecret?: string): Promise<StravaTokenResponse> {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: STRAVA_CLIENT_ID,
      client_secret: clientSecret || STRAVA_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
    }),
  });
  if (!r.ok) throw new Error(`strava token exchange failed: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function refreshToken(refreshTokenValue: string, clientSecret?: string): Promise<StravaTokenResponse> {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: STRAVA_CLIENT_ID,
      client_secret: clientSecret || STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshTokenValue,
    }),
  });
  if (!r.ok) throw new Error(`strava token refresh failed: ${r.status} ${await r.text()}`);
  return r.json();
}

export type StravaActivity = {
  id: number;
  name?: string;
  type?: string;
  sport_type?: string;
  start_date?: string;
  start_date_local?: string;
  distance?: number;
  moving_time?: number;
  total_elevation_gain?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed?: number;
  max_speed?: number;
  average_watts?: number;
  kilojoules?: number;
  suffer_score?: number;
  calories?: number;
};

export type HrZones = { z1: number; z2: number; z3: number; z4: number; z5: number }; // seconds per zone

export function computeHrZones(hrData: number[], maxHr: number): HrZones {
  const z = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  for (const bpm of hrData) {
    const pct = bpm / maxHr;
    if      (pct < 0.60) z.z1++;
    else if (pct < 0.70) z.z2++;
    else if (pct < 0.80) z.z3++;
    else if (pct < 0.90) z.z4++;
    else                 z.z5++;
  }
  return z;
}

export async function fetchActivity(activityId: number | string, accessToken: string): Promise<StravaActivity> {
  const r = await fetch(ACTIVITY_URL(activityId), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`fetchActivity failed: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function fetchHrStreams(activityId: number | string, accessToken: string): Promise<number[] | null> {
  const url = new URL(STREAMS_URL(activityId));
  url.searchParams.set("keys", "heartrate");
  url.searchParams.set("key_by_type", "true");
  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) return null;
  const data = await r.json() as Record<string, { data: number[] }>;
  return data?.heartrate?.data ?? null;
}

// Map a Strava activity payload to our `activities` row shape.
export function normalizeActivity(
  raw: StravaActivity,
  opts: { trainer_id: string; client_id: string; hrZones?: HrZones },
) {
  const metrics: Record<string, unknown> = {};
  for (const k of [
    "average_heartrate", "max_heartrate",
    "average_speed", "max_speed",
    "total_elevation_gain",
    "average_watts", "kilojoules", "suffer_score",
    "calories", "name",
  ] as const) {
    const v = raw[k];
    if (v !== undefined && v !== null) metrics[k] = v;
  }
  if (opts.hrZones) metrics.hr_zones = opts.hrZones;
  return {
    trainer_id: opts.trainer_id,
    client_id: opts.client_id,
    source: "strava",
    external_id: String(raw.id),
    started_at: raw.start_date ?? raw.start_date_local,
    type: raw.type ?? raw.sport_type,
    distance_m: raw.distance ?? null,
    duration_s: raw.moving_time ?? null,
    metrics,
  };
}
