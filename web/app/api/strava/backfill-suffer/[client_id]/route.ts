// Manual per-client suffer_score backfill — runs entirely in Next.js.
// GET  → count activities missing suffer_score (no Strava API calls)
// POST → streams NDJSON progress: { processed, updated, total } per activity,
//        then { done: true, updated, total, remaining }. Caps at MAX_PER_RUN
//        activities so we don't blow through Strava's 100 reads / 15-min
//        rate limit. The hourly cron picks up the rest.
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchActivity, fetchHrStreams, computeHrZones, normalizeActivity } from "@/lib/strava";
import { getStravaAccess } from "@/lib/strava-access";

const MAX_PER_RUN = 100;

async function getTokenAndActivities(client_id: string) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "unauthorized" as const };

  const admin = supabaseAdmin();

  const { data: activities } = await admin
    .from("activities")
    .select("id, external_id, client_id, trainer_id, metrics")
    .eq("client_id", client_id)
    .eq("source", "strava")
    .order("started_at", { ascending: false })
    .limit(500);

  // An activity counts as "backfilled" if it has ANY of: suffer_score, hr_zones,
  // or an explicit hr_backfilled_at marker. The marker covers activities that
  // legitimately have no HR data (e.g. yoga without an HR strap) so we don't
  // re-fetch them forever — without it, Strava users on the free tier (no
  // suffer_score) would have every activity look "missing" on every click.
  const missing = (activities ?? []).filter((a) => {
    const m = (a.metrics as Record<string, unknown> | null) ?? {};
    return !m.suffer_score && !m.hr_zones && !m.hr_backfilled_at;
  });

  return { user, missing };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ client_id: string }> }) {
  const { client_id } = await params;
  const result = await getTokenAndActivities(client_id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 401 });
  return NextResponse.json({ missing: result.missing.length });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ client_id: string }> }) {
  const { client_id } = await params;
  const result = await getTokenAndActivities(client_id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 401 });

  const { missing } = result;

  const admin = supabaseAdmin();

  const acc = await getStravaAccess(admin, client_id);
  if (!acc.ok) {
    return NextResponse.json(
      { error: acc.reason },
      { status: acc.reason === "not_connected" ? 412 : 409 },
    );
  }
  const access = acc.access;

  const missingTotal = missing.length;
  const batch = missing.slice(0, MAX_PER_RUN);
  const batchTotal = batch.length;
  const remainingAfter = missingTotal - batchTotal;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      let processed = 0;
      let updated = 0;

      for (const row of batch) {
        try {
          const raw = await fetchActivity(row.external_id as string, access);
          const maxHr = raw.max_heartrate ?? raw.average_heartrate ?? 190;
          const hrData = await fetchHrStreams(row.external_id as string, access);
          const hrZones = hrData && maxHr ? computeHrZones(hrData, maxHr) : undefined;
          const normalized = normalizeActivity(raw, {
            trainer_id: row.trainer_id as string,
            client_id:  row.client_id  as string,
            hrZones,
          });
          // Stamp a marker so this row never gets re-pulled, even when Strava
          // returned no suffer_score and the activity had no HR stream.
          (normalized.metrics as Record<string, unknown>).hr_backfilled_at =
            new Date().toISOString();
          await admin.from("activities").upsert(normalized, { onConflict: "source,external_id" });
          if (raw.suffer_score != null || hrZones) updated++;
        } catch { /* skip — row stays missing, will retry next run */ }

        processed++;
        send({ processed, updated, total: batchTotal });
      }

      // Surface the HR backfill in the trainer's Agent Activity feed.
      const trainerId = batch[0]?.trainer_id as string | undefined;
      if (trainerId && batchTotal > 0) {
        await admin.from("agent_runs").insert({
          trainer_id: trainerId,
          client_id,
          agent: "strava",
          flow: "hr-backfill",
          status: "completed",
          output: { updated, processed, remaining: remainingAfter },
        });
      }

      send({ done: true, updated, total: batchTotal, remaining: remainingAfter });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
  });
}
