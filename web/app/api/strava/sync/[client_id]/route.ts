// Incremental sync — pulls new activities since the most recent one in the DB.
// Used by "Sync now" button and the daily cron job.
//   GET  → detect only (no writes), returns { detected, after }
//   POST → pull + upsert + agent_runs write, returns { pulled }
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchActivity, fetchHrStreams, computeHrZones, normalizeActivity } from "@/lib/strava";
import { getStravaAccess, type StravaAccess } from "@/lib/strava-access";
import type { StravaActivity } from "@/lib/strava";

const ATHLETE_ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities";

// Map a non-ok access result to an HTTP response. 412 = never connected,
// 409 = token rejected by Strava (client must reconnect). `detail` carries
// Strava's own token-endpoint body through to the UI so the real cause shows.
function accessError(acc: Extract<StravaAccess, { ok: false }>) {
  return acc.reason === "not_connected"
    ? NextResponse.json({ error: "not_connected" }, { status: 412 })
    : NextResponse.json({ error: "reconnect_required", detail: acc.detail }, { status: 409 });
}

// A failed Strava data call. 401 means the access token itself was revoked
// (athlete deauthorized before the webhook reached us) → same 409 as a dead
// refresh token. Anything else passes Strava's own status + body straight
// through — it names the real cause (missing scope, inactive app, rate limit, …).
async function stravaApiError(r: Response, clientId: string) {
  const body = await r.text().catch(() => "");
  console.error(`[strava sync] ${r.status} for client ${clientId}: ${body}`);
  if (r.status === 401) {
    return NextResponse.json({ error: "reconnect_required", detail: body }, { status: 409 });
  }
  return NextResponse.json({ error: "strava_api_failed", status: r.status, body }, { status: 502 });
}

async function getAfter(admin: ReturnType<typeof supabaseAdmin>, clientId: string) {
  const { data: latest } = await admin
    .from("activities")
    .select("started_at")
    .eq("client_id", clientId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return latest?.started_at
    ? Math.floor(new Date(latest.started_at as string).getTime() / 1000)
    : Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
}

// Detect only — count new activities on Strava since the latest one in DB.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ client_id: string }> }) {
  const { client_id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();
  const { data: client } = await admin
    .from("clients").select("id").eq("id", client_id).maybeSingle();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const acc = await getStravaAccess(admin, client_id);
  if (!acc.ok) return accessError(acc);
  const access = acc.access;

  const after = await getAfter(admin, client_id);

  let page = 1;
  let detected = 0;
  while (true) {
    const r = await fetch(`${ATHLETE_ACTIVITIES_URL}?per_page=100&page=${page}&after=${after}`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    if (!r.ok) return await stravaApiError(r, client_id);
    const list = (await r.json()) as StravaActivity[];
    detected += list.length;
    if (list.length < 100) break;
    page++;
  }

  return NextResponse.json({ detected, after });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ client_id: string }> }) {
  const { client_id } = await params;

  const cronSecret = process.env.CRON_SECRET ?? "dev-secret";
  const isInternal = req.headers.get("x-internal-secret") === cronSecret;

  if (!isInternal) {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const { data: client } = await admin
    .from("clients").select("id, trainer_id, strava_athlete_id").eq("id", client_id).maybeSingle();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const acc = await getStravaAccess(admin, client_id);
  if (!acc.ok) return accessError(acc);
  const access = acc.access;

  const after = await getAfter(admin, client_id);

  let page = 1;
  let pulled = 0;
  const allRows: ReturnType<typeof normalizeActivity>[] = [];

  while (true) {
    const r = await fetch(`${ATHLETE_ACTIVITIES_URL}?per_page=100&page=${page}&after=${after}`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    if (!r.ok) return await stravaApiError(r, client_id);
    const list = (await r.json()) as StravaActivity[];
    if (list.length === 0) break;

    // Enrich each activity with detailed fields + HR zones
    for (const summary of list) {
      const raw = await fetchActivity(summary.id, access).catch(() => summary);
      const maxHr = raw.max_heartrate ?? raw.average_heartrate ?? 190;
      const hrData = await fetchHrStreams(summary.id, access).catch(() => null);
      const hrZones = hrData && maxHr ? computeHrZones(hrData, maxHr) : undefined;
      allRows.push(normalizeActivity(raw, { trainer_id: client.trainer_id, client_id: client.id, hrZones }));
    }
    pulled += list.length;

    if (list.length < 100) break;
    page++;
  }

  if (allRows.length > 0) {
    await admin.from("activities").upsert(allRows, { onConflict: "source,external_id" });
  }

  if (pulled > 0) {
    await admin.from("agent_runs").insert({
      trainer_id: client.trainer_id,
      client_id: client.id,
      agent: "strava",
      flow: "incremental-sync",
      status: "completed",
      output: { pulled },
    });
  }

  return NextResponse.json({ pulled });
}
