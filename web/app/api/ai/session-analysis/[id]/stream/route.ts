import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { proxyAgentStream } from "@/lib/ai-stream";

export const dynamic = "force-dynamic";

// Trainer-only: analyse a client's most recent workout session. Verifies the
// trainer owns the client before proxying to the Python session-analysis flow.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: client } = await supabase
    .from("clients").select("id").eq("id", id).eq("trainer_id", user.id).maybeSingle();
  if (!client) return NextResponse.json({ error: "client_not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  return proxyAgentStream(`/flows/session-analysis/${id}/stream`, {
    llm_model: body?.llm_model,
  });
}
