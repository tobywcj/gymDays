// Scheduled-agent dispatcher. Called every 5 minutes by pg_cron
// ("gymdays-agent-dispatch"), protected by the x-cron-secret header.
//
// For every enabled schedule that is due, run its messaging flow for each
// target client — the flow drafts and sends a Telegram message — then advance
// next_run_at so it fires again next cadence.
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runMessagingFlow, type FlowName } from "@/lib/ai-service";
import { computeNextRun, type Frequency } from "@/lib/schedule";

type ScheduleRow = {
  id: string;
  trainer_id: string;
  flow: FlowName;
  target_all: boolean;
  client_ids: string[];
  frequency: Frequency;
  hour: number;
  minute: number;
  weekday: number | null;
  tz_offset_minutes: number;
};

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET ?? "dev-secret";
  if (req.headers.get("x-cron-secret") !== cronSecret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const now = new Date();

  const { data: due, error } = await admin
    .from("scheduled_agents")
    .select("*")
    .eq("enabled", true)
    .lte("next_run_at", now.toISOString())
    .returns<ScheduleRow[]>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Array<{ id: string; fired: number; failed: number }> = [];

  for (const s of due ?? []) {
    // Resolve targets: all Active clients for the trainer, or the chosen list.
    let clientIds: string[];
    if (s.target_all) {
      const { data: clients } = await admin
        .from("clients").select("id").eq("trainer_id", s.trainer_id).eq("status", "Active");
      clientIds = (clients ?? []).map((c) => c.id as string);
    } else {
      clientIds = s.client_ids ?? [];
    }

    const outcomes = await Promise.allSettled(
      clientIds.map((cid) => runMessagingFlow(cid, s.flow)),
    );
    const fired = outcomes.filter((o) => o.status === "fulfilled").length;
    const failed = outcomes.length - fired;

    const next = computeNextRun(
      {
        frequency: s.frequency,
        hour: s.hour,
        minute: s.minute,
        weekday: s.weekday,
        tzOffsetMinutes: s.tz_offset_minutes,
      },
      now,
    );

    await admin
      .from("scheduled_agents")
      .update({ last_run_at: now.toISOString(), next_run_at: next.toISOString() })
      .eq("id", s.id);

    results.push({ id: s.id, fired, failed });
  }

  return NextResponse.json({ dispatched: results.length, results });
}
