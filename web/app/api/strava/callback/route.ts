// Strava OAuth callback. Exchanges the one-time code for tokens, writes them
// to `integration_tokens`, and links the client to the Strava athlete.
//
// Returns a tiny HTML page (not a redirect) so the flow works whether the
// authorize step ran in a popup or a full tab:
//   - popup  → postMessage to window.opener + self-close
//   - full   → redirect to the client page
import { type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exchangeCode, hasActivityScope } from "@/lib/strava";
import { resolveStravaSecret } from "@/lib/strava-access";

function closingPage(
  origin: string,
  payload: { ok: boolean; clientId?: string; error?: string; isPublic?: boolean },
  clearCookies: boolean,
): Response {
  const dest = payload.isPublic
    ? (payload.ok ? `/connect/strava/done` : `/connect/strava/error?reason=${encodeURIComponent(payload.error ?? "unknown")}`)
    : (payload.ok
        ? `/clients/${payload.clientId}?strava=connected`
        : `/?strava_error=${encodeURIComponent(payload.error ?? "unknown")}`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Strava</title></head>
<body style="font-family:system-ui;background:#1c2418;color:#f4ede2;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center">
  <div style="font-size:14px">${payload.ok ? "Strava connected ✓" : "Strava connection failed"}</div>
  <div style="font-size:12px;opacity:.6;margin-top:6px">You can close this window.</div>
</div>
<script>
  (function () {
    var msg = ${JSON.stringify({ type: "strava-oauth", ...payload })};
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(msg, ${JSON.stringify(origin)});
        window.close();
        return;
      }
    } catch (e) {}
    // Not a popup (or opener gone): navigate this tab to the destination.
    window.location.replace(${JSON.stringify(dest)});
  })();
</script>
</body></html>`;
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
  if (clearCookies) {
    headers.append("Set-Cookie", "strava_oauth_state=; Path=/; Max-Age=0");
    headers.append("Set-Cookie", "strava_oauth_client=; Path=/; Max-Age=0");
    headers.append("Set-Cookie", "strava_oauth_public=; Path=/; Max-Age=0");
  }
  return new Response(html, { status: 200, headers });
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const grantedScope = req.nextUrl.searchParams.get("scope");
  const cookieState = req.cookies.get("strava_oauth_state")?.value;
  const cookieClient = req.cookies.get("strava_oauth_client")?.value;
  const isPublic = req.cookies.get("strava_oauth_public")?.value === "1";

  if (!code || !state || state !== cookieState || !cookieClient) {
    return closingPage(origin, { ok: false, error: "invalid_state", isPublic }, true);
  }

  const admin = supabaseAdmin();
  let clientRow: { id: string; trainer_id: string } | null = null;

  if (isPublic) {
    // Public flow: no trainer session — the connect token was already
    // validated + consumed at /api/strava/prepare-public, so the cookieClient
    // is server-trusted. Look up via service role.
    const { data } = await admin
      .from("clients").select("id, trainer_id").eq("id", cookieClient).maybeSingle();
    clientRow = data ?? null;
  } else {
    // Trainer flow: must be signed in.
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return closingPage(origin, { ok: false, error: "not_signed_in" }, true);
    const { data } = await supabase
      .from("clients").select("id, trainer_id").eq("id", cookieClient).maybeSingle();
    clientRow = data ?? null;
  }

  if (!clientRow) return closingPage(origin, { ok: false, error: "client_not_found", isPublic }, true);

  // Strava reports the granted scope on the callback. If the athlete unticked
  // "View data about your activities", the exchange still yields a token, but
  // every activities call 403s — so reject here rather than storing a token and
  // showing a "Connected" state that can never sync.
  if (!hasActivityScope(grantedScope)) {
    return closingPage(origin, { ok: false, error: "missing_activity_permission", isPublic }, true);
  }

  try {
    const secret = await resolveStravaSecret(admin, clientRow.trainer_id);
    const tok = await exchangeCode(code, secret);

    await admin.from("integration_tokens").upsert({
      trainer_id:    clientRow.trainer_id,
      client_id:     clientRow.id,
      provider:      "strava",
      access_token:  tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at:    new Date(tok.expires_at * 1000).toISOString(),
    }, { onConflict: "client_id,provider" });

    if (tok.athlete?.id) {
      await admin.from("clients").update({
        strava_athlete_id: String(tok.athlete.id),
      }).eq("id", clientRow.id);
    }

    return closingPage(origin, { ok: true, clientId: clientRow.id, isPublic }, true);
  } catch (e) {
    return closingPage(origin, { ok: false, error: (e as Error).message, isPublic }, true);
  }
}
