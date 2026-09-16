import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { recomputeInjuryHistory } from "@/lib/injury-history";

// Trainer-only: update a client's official injury status. Appends an immutable
// 'trainer' entry to client_injury_log (the audit trail) and sets the canonical
// clients.injury_history that the whole app reads. Clients cannot call this —
// RLS + the explicit trainer_id check enforce trainer ownership.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: client } = await supabase
    .from("clients").select("id").eq("id", id).eq("trainer_id", user.id).maybeSingle();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 4000) : "";

  // Append a new trail entry, then recompute the canonical status from the trail.
  const { error: logErr } = await supabase.from("client_injury_log").insert({
    client_id: id, trainer_id: user.id, source: "trainer", note: note || null,
  });
  if (logErr) return NextResponse.json({ error: logErr.message }, { status: 400 });

  const injury_history = await recomputeInjuryHistory(supabase, id);
  return NextResponse.json({ ok: true, injury_history });
}
