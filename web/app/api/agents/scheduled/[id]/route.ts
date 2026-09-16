// Toggle / delete a single scheduled agent activity.
//   PATCH  /api/agents/scheduled/:id  — { enabled }  (enable/disable).
//   DELETE /api/agents/scheduled/:id  — remove it.
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { computeNextRun, type Frequency } from "@/lib/schedule";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled required" }, { status: 422 });
  }

  // Re-enabling a paused schedule: recompute next_run from its own cadence so
  // it doesn't immediately fire on a stale (past) next_run_at.
  const update: Record<string, unknown> = { enabled: body.enabled };
  if (body.enabled) {
    const { data: row } = await supabase
      .from("scheduled_agents").select("*").eq("id", id).eq("trainer_id", user.id).maybeSingle();
    if (row) {
      const next = computeNextRun({
        frequency: row.frequency as Frequency,
        hour: row.hour as number,
        minute: row.minute as number,
        weekday: (row.weekday as number | null) ?? null,
        tzOffsetMinutes: row.tz_offset_minutes as number,
      });
      update.next_run_at = next.toISOString();
    }
  }

  const { data, error } = await supabase
    .from("scheduled_agents")
    .update(update)
    .eq("id", id)
    .eq("trainer_id", user.id)
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ schedule: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("scheduled_agents")
    .delete()
    .eq("id", id)
    .eq("trainer_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deleted: true, id });
}
