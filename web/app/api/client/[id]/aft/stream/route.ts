import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth/viewer";
import { proxyAgentStream } from "@/lib/ai-stream";

export const dynamic = "force-dynamic";

// Streams the Progress agent's AFT classification (live thought process + final
// result) for the Programme page's AFT card. Trainer-initiated (spends tokens +
// writes clients.aft_*).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (viewer.role !== "trainer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const supabase = await supabaseServer();
  const { data: client } = await supabase
    .from("clients").select("id, trainer_id").eq("id", id).maybeSingle<{ id: string; trainer_id: string }>();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (client.trainer_id !== viewer.userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  return proxyAgentStream(`/flows/aft-classification/${id}/stream`, { llm_model: body?.llm_model });
}
