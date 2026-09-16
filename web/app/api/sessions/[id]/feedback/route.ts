import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Trainer-only: save feedback on one scheduled session. This note feeds the
// Programme "Last Session Analysis" (the AI weighs it alongside activity data).
// The sessions_owner RLS policy scopes the update to the trainer's own rows, so
// the authenticated client writes directly — no service role needed.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const raw = typeof body?.feedback === "string" ? body.feedback.trim() : "";
  const feedback = raw ? raw.slice(0, 4000) : null;

  const { data, error } = await supabase
    .from("sessions")
    .update({ feedback, feedback_at: feedback ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("trainer_id", user.id) // belt-and-braces with RLS
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, feedback });
}
