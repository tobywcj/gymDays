import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth/viewer";

// Client self-report from the portal. Appends a 'screening' (self-report) entry
// to their own injury trail — it flags via the caveat aggregation and shows up
// for the trainer to confirm. It does NOT set the official status (trainer
// authority preserved). RLS (injury_log_client_insert) double-enforces scope.
export async function POST(req: NextRequest) {
  const viewer = await getViewer();
  if (viewer.role !== "client") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const clientId = viewer.clientIds[0];
  if (!clientId) return NextResponse.json({ error: "no_client" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 4000) : "";
  if (!note) return NextResponse.json({ error: "empty" }, { status: 400 });

  const supabase = await supabaseServer();
  const { error } = await supabase.from("client_injury_log").insert({
    client_id: clientId, trainer_id: null, source: "client_report", note,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
