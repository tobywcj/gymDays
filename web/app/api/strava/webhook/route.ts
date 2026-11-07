// Strava webhook receiver.
//   GET  — Strava subscription verification handshake.
//   POST — activity event (create / update / delete) → ingest into `activities`;
//          athlete deauthorization → drop the client's Strava link.
//
// Strava events: https://developers.strava.com/docs/webhooks/
// Strava retries any non-200 response (up to 3x), so every handled failure —
// dead token, inactive app, deleted activity — answers 200 with a status body
// instead of a bare 500 that would just be replayed.
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { STRAVA_VERIFY_TOKEN, fetchActivity, normalizeActivity } from "@/lib/strava";
import { clearStravaLink, getStravaAccess } from "@/lib/strava-access";
import { triggerPostWorkoutAnalysis } from "@/lib/ai-service";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  // An unset STRAVA_VERIFY_TOKEN must not match an empty `hub.verify_token`.
  if (
    sp.get("hub.mode") === "subscribe" &&
    STRAVA_VERIFY_TOKEN !== "" &&
    sp.get("hub.verify_token") === STRAVA_VERIFY_TOKEN
  ) {
    return NextResponse.json({ "hub.challenge": sp.get("hub.challenge") });
  }
  return NextResponse.json({ error: "invalid verification" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const event = await req.json();
  // event = { object_type, object_id, aspect_type, owner_id, updates, ... }

  const db = supabaseAdmin();

  // Athlete revoked our app on Strava: { object_type: "athlete",
  // aspect_type: "update", updates: { authorized: "false" } }. Their tokens are
  // now dead — clear the link so the UI shows "connect" rather than failing syncs.
  if (event.object_type === "athlete") {
    if (String(event.updates?.authorized) !== "false") {
      return NextResponse.json({ status: "ignored", reason: "athlete update" });
    }
    const { data: linked } = await db
      .from("clients")
      .select("id")
      .eq("strava_athlete_id", String(event.owner_id));
    for (const c of linked ?? []) await clearStravaLink(db, c.id as string);
    return NextResponse.json({ status: "deauthorized", clients: (linked ?? []).length });
  }

  if (event.object_type !== "activity") {
    return NextResponse.json({ status: "ignored", reason: `object_type=${event.object_type}` });
  }

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

  // Pull a token for this client (refresh + persist rotation if needed).
  const acc = await getStravaAccess(db, client.id);
  if (!acc.ok) {
    console.error(`[strava webhook] ${acc.reason} for client ${client.id}`,
      acc.reason === "reconnect_required" ? acc.detail : "");
    return NextResponse.json({ status: "skipped", reason: acc.reason });
  }

  let raw;
  try {
    raw = await fetchActivity(event.object_id, acc.access);
  } catch (e) {
    // 403 app Inactive, 404 activity made private/deleted, 429 rate limit, …
    console.error(`[strava webhook] fetch failed for activity ${event.object_id}:`, (e as Error).message);
    return NextResponse.json({ status: "fetch_failed", detail: (e as Error).message });
  }
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
