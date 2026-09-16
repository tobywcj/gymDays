// Strava webhook receiver.
//   GET  — Strava subscription verification handshake.
//   POST — activity event (create / update / delete) → ingest into `activities`.
//
// Strava events: https://developers.strava.com/docs/webhooks/
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  STRAVA_VERIFY_TOKEN, refreshToken, fetchActivity, normalizeActivity,
} from "@/lib/strava";
import { resolveStravaSecret } from "@/lib/strava-access";
import { triggerPostWorkoutAnalysis } from "@/lib/ai-service";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get("hub.mode") === "subscribe" && sp.get("hub.verify_token") === STRAVA_VERIFY_TOKEN) {
    return NextResponse.json({ "hub.challenge": sp.get("hub.challenge") });
  }
  return NextResponse.json({ error: "invalid verification" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const event = await req.json();
  // event = { object_type, object_id, aspect_type, owner_id, ... }

  if (event.object_type !== "activity") {
    return NextResponse.json({ status: "ignored", reason: `object_type=${event.object_type}` });
  }

  const db = supabaseAdmin();

  if (event.aspect_type === "delete") {
    await db.from("activities")
      .delete()
      .eq("source", "strava")
      .eq("external_id", String(event.object_id));
    return NextResponse.json({ status: "deleted", external_id: event.object_id });
  }

  // Find which of our clients owns this Strava athlete.
  const { data: client } = await db
    .from("clients")
    .select("id, trainer_id")
    .eq("strava_athlete_id", String(event.owner_id))
    .limit(1)
    .maybeSingle();
  if (!client) {
    return NextResponse.json({
      status: "ignored",
      reason: `no client linked to athlete ${event.owner_id}`,
    });
  }

  // Pull a token for this client (refresh if needed).
  const { data: tokenRow } = await db
    .from("integration_tokens")
    .select("id, access_token, refresh_token, expires_at")
    .eq("client_id", client.id)
    .eq("provider", "strava")
    .limit(1)
    .maybeSingle();
  if (!tokenRow) {
    return NextResponse.json({ status: "ignored", reason: "no token stored" });
  }

  let access = tokenRow.access_token as string;
  const expiresAt = tokenRow.expires_at
    ? Math.floor(new Date(tokenRow.expires_at as string).getTime() / 1000)
    : 0;
  if (!expiresAt || expiresAt <= Math.floor(Date.now() / 1000) + 60) {
    const secret = await resolveStravaSecret(db, client.trainer_id);
    const refreshed = await refreshToken(tokenRow.refresh_token as string, secret);
    access = refreshed.access_token;
    await db.from("integration_tokens").update({
      access_token:  refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at:    new Date(refreshed.expires_at * 1000).toISOString(),
    }).eq("id", tokenRow.id);
  }

  const raw = await fetchActivity(event.object_id, access);
  const row = normalizeActivity(raw, { trainer_id: client.trainer_id, client_id: client.id });
  await db.from("activities").upsert(row, { onConflict: "source,external_id" });

  // Real-time refuel: only on a brand-new activity (not edits/updates), fire the
  // post-workout analysis + nutrition message. The AI endpoint returns 202 fast
  // (runs the flow in the background), so this stays inside Strava's response
  // window. Never blocks ingestion on the nudge.
  let nudged = false;
  if (event.aspect_type === "create") {
    nudged = await triggerPostWorkoutAnalysis(client.id);
  }

  return NextResponse.json({
    status: "ingested", external_id: row.external_id, client_id: client.id, nudged,
  });
}
