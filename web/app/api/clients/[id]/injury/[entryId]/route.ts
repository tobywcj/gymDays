import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { recomputeInjuryHistory } from "@/lib/injury-history";

// Trainer-only: edit or delete a single injury trail entry (to fix a mistake).
// RLS (injury_log_trainer_update/delete) scopes to the trainer's own clients;
// after either op we recompute the canonical clients.injury_history.

async function auth(id: string) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const { data: client } = await supabase
    .from("clients").select("id").eq("id", id).eq("trainer_id", user.id).maybeSingle();
  if (!client) return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  return { supabase };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { id, entryId } = await params;
  const { supabase, error } = await auth(id);
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};
  if (typeof body?.note === "string") update.note = body.note.trim().slice(0, 4000) || null;
  if (typeof body?.resolved === "boolean") update.resolved_at = body.resolved ? new Date().toISOString() : null;
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });

  const { data, error: upErr } = await supabase!
    .from("client_injury_log")
    .update(update)
    .eq("id", entryId).eq("client_id", id)
    .select("id").maybeSingle();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "entry_not_found" }, { status: 404 });

  const injury_history = await recomputeInjuryHistory(supabase!, id);
  return NextResponse.json({ ok: true, injury_history });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { id, entryId } = await params;
  const { supabase, error } = await auth(id);
  if (error) return error;

  const { error: delErr } = await supabase!
    .from("client_injury_log").delete().eq("id", entryId).eq("client_id", id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

  const injury_history = await recomputeInjuryHistory(supabase!, id);
  return NextResponse.json({ ok: true, injury_history });
}
