// Trainer-authed: mint a one-shot Strava connect token. Returns the public URL
// the trainer should send to their client (via Telegram/email/etc). The client
// opens the URL on their own device and completes the real Strava OAuth flow.
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const TOKEN_TTL_DAYS = 7;

export async function POST(req: NextRequest, { params }: { params: Promise<{ client_id: string }> }) {
  const { client_id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: client } = await supabase
    .from("clients").select("id, trainer_id").eq("id", client_id).maybeSingle();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const token = randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + TOKEN_TTL_DAYS * 86400_000).toISOString();

  const admin = supabaseAdmin();
  const { error } = await admin.from("strava_connect_tokens").insert({
    trainer_id: client.trainer_id,
    client_id: client.id,
    token,
    expires_at: expires,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const url = `${req.nextUrl.origin}/connect/strava/${token}`;
  return NextResponse.json({ token, url, expires_at: expires });
}
