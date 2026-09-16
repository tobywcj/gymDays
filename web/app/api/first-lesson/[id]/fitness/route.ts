import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

type Body = {
  battery: { battery: unknown[]; skipped: unknown[] } | null;
  results: Record<string, number | string | null>;
  notes?: string;
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;

  // Refuse to write if training is blocked — defense in depth (the UI also blocks).
  const { data: client } = await supabase
    .from("clients")
    .select("training_blocked, training_blocked_reason")
    .eq("id", id)
    .single();
  if (client?.training_blocked) {
    return NextResponse.json(
      { error: `training_blocked: ${client.training_blocked_reason ?? "BP threshold"}` },
      { status: 422 },
    );
  }

  const { error } = await supabase
    .from("fitness_assessments")
    .insert({
      trainer_id: user.id,
      client_id: id,
      battery: body.battery ?? {},
      results: body.results ?? {},
      designed_by: body.battery ? "planner_agent" : "trainer_manual",
      notes: body.notes ?? null,
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
