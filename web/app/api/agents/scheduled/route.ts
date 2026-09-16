// Trainer-defined scheduled agent activities.
//   GET  /api/agents/scheduled  — list this trainer's schedules.
//   POST /api/agents/scheduled  — create a schedule.
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { computeNextRun, type Frequency } from "@/lib/schedule";

const FLOWS = ["daily-reminder", "weekly-checkin", "post-session-nudge"] as const;
type Flow = (typeof FLOWS)[number];

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("scheduled_agents")
    .select("*")
    .eq("trainer_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ schedules: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const flow = body?.flow as Flow;
  const targetAll = !!body?.target_all;
  const clientIds: string[] = Array.isArray(body?.client_ids) ? body.client_ids.map(String) : [];
  const frequency = body?.frequency as Frequency;
  const hour = Number(body?.hour);
  const minute = Number(body?.minute);
  const weekday = body?.weekday == null ? null : Number(body.weekday);
  const tzOffsetMinutes = Number.isFinite(Number(body?.tz_offset_minutes)) ? Number(body.tz_offset_minutes) : 0;

  if (!name) return NextResponse.json({ error: "name required" }, { status: 422 });
  if (!FLOWS.includes(flow)) return NextResponse.json({ error: "invalid flow" }, { status: 422 });
  if (frequency !== "daily" && frequency !== "weekly") {
    return NextResponse.json({ error: "invalid frequency" }, { status: 422 });
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return NextResponse.json({ error: "invalid hour" }, { status: 422 });
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return NextResponse.json({ error: "invalid minute" }, { status: 422 });
  if (frequency === "weekly" && (weekday == null || weekday < 0 || weekday > 6)) {
    return NextResponse.json({ error: "weekday required for weekly" }, { status: 422 });
  }
  if (!targetAll && clientIds.length === 0) {
    return NextResponse.json({ error: "select at least one client" }, { status: 422 });
  }

  // Guard against attaching another trainer's clients.
  if (!targetAll && clientIds.length > 0) {
    const { data: owned } = await supabase
      .from("clients").select("id").eq("trainer_id", user.id).in("id", clientIds);
    const ownedIds = new Set((owned ?? []).map((c) => c.id as string));
    if (clientIds.some((id) => !ownedIds.has(id))) {
      return NextResponse.json({ error: "unknown client" }, { status: 422 });
    }
  }

  const nextRun = computeNextRun({ frequency, hour, minute, weekday: frequency === "weekly" ? weekday : null, tzOffsetMinutes });

  const { data, error } = await supabase
    .from("scheduled_agents")
    .insert({
      trainer_id: user.id,
      name,
      flow,
      target_all: targetAll,
      client_ids: targetAll ? [] : clientIds,
      frequency,
      hour,
      minute,
      weekday: frequency === "weekly" ? weekday : null,
      tz_offset_minutes: tzOffsetMinutes,
      next_run_at: nextRun.toISOString(),
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ schedule: data });
}
