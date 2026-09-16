import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Trainer approves / declines a client's program-change request. RLS (owner
// policy) guarantees a trainer can only touch requests addressed to them.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (viewer.role !== "trainer") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const { status, trainer_note } = await req.json().catch(() => ({}));
  if (status !== "approved" && status !== "declined") {
    return NextResponse.json({ error: "bad status" }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("program_change_requests")
    .update({
      status,
      trainer_note: trainer_note ? String(trainer_note).slice(0, 2000) : null,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("trainer_id", viewer.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
