// Full historical sync — paginates ALL activities from Strava.
// Called fire-and-forget from the OAuth callback after first connect.
// Can also be triggered manually; protected by CRON_SECRET or user auth.
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizeActivity } from "@/lib/strava";
import { getStravaAccess } from "@/lib/strava-access";
import type { StravaActivity } from "@/lib/strava";

const ATHLETE_ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities";

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
    .from("clients").select("id, trainer_id").eq("id", client_id).maybeSingle();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const acc = await getStravaAccess(admin, client_id);
  if (!acc.ok) {
    return NextResponse.json(
      acc.reason === "not_connected"
        ? { error: "not_connected" }
        : { error: "reconnect_required", detail: acc.detail },
      { status: acc.reason === "not_connected" ? 412 : 409 },
    );
  }
  const access = acc.access;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      let page = 1;
      let totalFetched = 0;
      const allRows: ReturnType<typeof normalizeActivity>[] = [];

      while (true) {
        const r = await fetch(`${ATHLETE_ACTIVITIES_URL}?per_page=100&page=${page}`, {
          headers: { Authorization: `Bearer ${access}` },
        });
        if (!r.ok) {
          const body = await r.text().catch(() => "");
          console.error(`[strava full-sync] ${r.status} for client ${client_id}: ${body}`);
          // Pass Strava's own status + response body straight through — it names
          // the real cause (missing scope, inactive app, rate limit, …).
          send({ error: `strava_api_failed: ${r.status}`, detail: body });
          controller.close();
          return;
        }
        const list = (await r.json()) as StravaActivity[];
        if (list.length === 0) break;

        for (const a of list) {
          allRows.push(normalizeActivity(a, { trainer_id: client.trainer_id, client_id: client.id }));
        }
        totalFetched += list.length;
        send({ page, total_so_far: totalFetched });

        if (list.length < 100) break;
        page++;
      }

      // Batch upsert in chunks of 200
      for (let i = 0; i < allRows.length; i += 200) {
        await admin.from("activities").upsert(allRows.slice(i, i + 200), { onConflict: "source,external_id" });
      }

      await admin.from("agent_runs").insert({
        trainer_id: client.trainer_id,
        client_id: client.id,
        agent: "strava",
        flow: "full-sync",
        status: "completed",
        output: { total: totalFetched },
      });

      send({ done: true, total: totalFetched });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
