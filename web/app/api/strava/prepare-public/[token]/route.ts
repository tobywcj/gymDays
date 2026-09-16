// Public (unauthenticated): the client opens /connect/strava/<token> on their
// own device. The page POSTs here to mint OAuth state. We validate + consume
// the token server-side (service role, single-use), then set the same state
// cookies the regular /api/strava/prepare flow uses — plus an extra
// `strava_oauth_public` cookie so /api/strava/callback knows to skip the
// trainer-auth check.
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = supabaseAdmin();

  const { data, error } = await admin
    .rpc("strava_connect_consume", { p_token: token });
  const rows = data as unknown as { client_id: string; trainer_id: string }[] | null;
  const row = rows?.[0];
  if (error || !row) {
    return NextResponse.json({ error: "token_invalid_or_used" }, { status: 410 });
  }

  const state = randomBytes(16).toString("base64url");
  const res = NextResponse.json({ state, clientId: row.client_id });
  const opts = { httpOnly: true, secure: true, sameSite: "lax" as const, maxAge: 600, path: "/" };
  res.cookies.set("strava_oauth_state",  state,         opts);
  res.cookies.set("strava_oauth_client", row.client_id, opts);
  res.cookies.set("strava_oauth_public", "1",           opts);
  return res;
}
