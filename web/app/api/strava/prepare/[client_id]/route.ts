// UI-initiated OAuth: the browser POSTs here BEFORE redirecting to Strava.
// We validate the trainer owns the client + set short-lived state cookies that
// /api/strava/callback can verify. The browser then navigates to Strava itself.
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ client_id: string }> }) {
  const { client_id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: client } = await supabase
    .from("clients").select("id").eq("id", client_id).maybeSingle();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const state = randomBytes(16).toString("base64url");
  const res = NextResponse.json({ state });
  res.cookies.set("strava_oauth_state",  state,     { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  res.cookies.set("strava_oauth_client", client_id, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
