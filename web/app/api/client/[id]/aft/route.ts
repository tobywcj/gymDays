import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth/viewer";
import { runAftClassification } from "@/lib/ai-service";

// Read the client's currently-stored AFT classification (no LLM, no write).
// Used when the trainer switches client on the Programme page.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (viewer.role === "none") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (viewer.role === "client" && !viewer.clientIds.includes(id)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("clients")
    .select("aft_level, aft_rationale, aft_signals, aft_classified_at")
    .eq("id", id)
    .maybeSingle();
  return NextResponse.json(data ?? { aft_level: null, aft_rationale: null, aft_signals: null, aft_classified_at: null });
}

// Run the Progress agent's AFT (All-round Fitness Training) classification for a
// client using ALL available data, persist it (the flow writes clients.aft_*),
// and return it. Trainer-initiated from the Programme page's AFT card refresh.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (viewer.role === "none") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Classification is a trainer action (it spends LLM tokens + writes the row).
  if (viewer.role !== "trainer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const supabase = await supabaseServer();
  const { data: client } = await supabase
    .from("clients").select("id, trainer_id").eq("id", id).maybeSingle<{ id: string; trainer_id: string }>();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (client.trainer_id !== viewer.userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const llm_model = body?.llm_model ? String(body.llm_model) : undefined;

  try {
    const result = await runAftClassification(id, llm_model);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
