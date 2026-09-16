import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth/viewer";

export const dynamic = "force-dynamic";

// Return the client's most recent weekly program ({ week_start, plan }). Used by
// the global /programme page to load the planner card client-side when a trainer
// picks a client (mirrors the caveats fetch). Returns { program: null } when none.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (viewer.role === "none") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = await supabaseServer();
  const { data: client } = await supabase
    .from("clients").select("id").eq("id", id).maybeSingle<{ id: string }>();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (viewer.role === "client" && !viewer.clientIds.includes(id)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: program } = await supabase
    .from("programs")
    .select("week_start, plan")
    .eq("client_id", id)
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ program: program ?? null });
}
