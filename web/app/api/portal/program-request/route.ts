import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// A client files a program-change request for their trainer to review. This is
// the portal's one client-write path. trainer_id is derived server-side from the
// client's own row, so the client never addresses an arbitrary trainer; the
// insert still passes through the self-insert RLS policy under the user session.
export async function POST(req: NextRequest) {
  const viewer = await getViewer();
  if (viewer.role !== "client") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { body } = await req.json().catch(() => ({}));
  const text = String(body ?? "").trim();
  if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (text.length > 2000) return NextResponse.json({ error: "too long" }, { status: 400 });

  const clientId = viewer.clientIds[0];
  const supabase = await supabaseServer();
  const { data: client } = await supabase
    .from("clients").select("trainer_id").eq("id", clientId).maybeSingle<{ trainer_id: string }>();
  if (!client) return NextResponse.json({ error: "no client" }, { status: 403 });

  const { error } = await supabase.from("program_change_requests").insert({
    trainer_id: client.trainer_id,
    client_id: clientId,
    body: text,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
