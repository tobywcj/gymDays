import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Per-trainer "not recommended" overlay. RLS (trainer_exercise_flags_owner)
// enforces trainer_id = auth.uid(), so the trainer's own authenticated client
// writes directly — no service role needed.

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: ex } = await supabase.from("exercise_db").select("id").eq("id", id).maybeSingle();
  if (!ex) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { error } = await supabase
    .from("trainer_exercise_flags")
    .upsert({ trainer_id: user.id, exercise_id: id, status: "not_recommended" }, { onConflict: "trainer_id,exercise_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ flagged: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("trainer_exercise_flags")
    .delete()
    .eq("trainer_id", user.id)
    .eq("exercise_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ flagged: false });
}
