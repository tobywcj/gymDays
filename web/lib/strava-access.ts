// Resolve a valid Strava access token for a client, refreshing + persisting the
// rotated token when the stored one is expired.
//
// Crucially, this distinguishes three states so callers never surface a bare 500:
//   - not_connected      → no token row (client never linked, or disconnected)
//   - reconnect_required → Strava rejected the refresh token (revoked, rotated
//                          out-of-band, or the app was deauthorized) — the client
//                          must re-run the OAuth connect flow to mint fresh tokens
//   - ok                 → a usable access token
import { refreshToken } from "./strava";
import { supabaseAdmin } from "./supabase/admin";
import { getTrainerSecrets, resolveSecret } from "./trainer-secrets";

export type StravaAccess =
  | { ok: true; access: string }
  | { ok: false; reason: "not_connected" }
  | { ok: false; reason: "reconnect_required"; detail: string };

/**
 * Resolve the Strava app secret for a trainer: their UI-managed value in
 * `trainer_secrets` (Settings → Secrets) first, then the STRAVA_CLIENT_SECRET
 * env fallback. Returns undefined only when neither is set. Server-only.
 */
export async function resolveStravaSecret(
  admin: ReturnType<typeof supabaseAdmin>,
  trainerId: string | null | undefined,
): Promise<string | undefined> {
  const secrets = trainerId ? await getTrainerSecrets(admin, trainerId) : undefined;
  return resolveSecret(secrets, "STRAVA_CLIENT_SECRET");
}

export async function getStravaAccess(
  admin: ReturnType<typeof supabaseAdmin>,
  clientId: string,
): Promise<StravaAccess> {
  const { data: row } = await admin
    .from("integration_tokens")
    .select("id, trainer_id, access_token, refresh_token, expires_at")
    .eq("client_id", clientId)
    .eq("provider", "strava")
    .maybeSingle();
  if (!row) return { ok: false, reason: "not_connected" };

  let access = row.access_token as string;
  const expiresAt = row.expires_at
    ? Math.floor(new Date(row.expires_at as string).getTime() / 1000)
    : 0;

  if (!expiresAt || expiresAt <= Math.floor(Date.now() / 1000) + 60) {
    try {
      const secret = await resolveStravaSecret(admin, row.trainer_id as string | null);
      const refreshed = await refreshToken(row.refresh_token as string, secret);
      access = refreshed.access_token;
      await admin.from("integration_tokens").update({
        access_token:  refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at:    new Date(refreshed.expires_at * 1000).toISOString(),
      }).eq("id", row.id);
    } catch (e) {
      return { ok: false, reason: "reconnect_required", detail: (e as Error).message };
    }
  }
  return { ok: true, access };
}
