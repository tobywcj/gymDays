import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { supabaseServer } from "@/lib/supabase/server";
import { proxyAgentStream } from "@/lib/ai-stream";

export const dynamic = "force-dynamic";

// Per-card exercise coach. Reuses the planner/concierge persona on the Python
// side. client_id is optional; when present the flow binds that client's memory
// tools. Authorization: a trainer may only pass a client they own; a client
// viewer is locked to their own client row (any provided id is ignored).
export async function POST(req: NextRequest) {
  const viewer = await getViewer();
  if (viewer.role === "none") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const requestedClientId = body?.client_id ? String(body.client_id) : null;

  let clientId: string | null = null;
  if (viewer.role === "client") {
    clientId = viewer.clientIds[0] ?? null;
  } else if (requestedClientId) {
    // trainer: verify ownership before passing the id downstream
    const supabase = await supabaseServer();
    const { data: client } = await supabase
      .from("clients").select("id").eq("id", requestedClientId).eq("trainer_id", viewer.userId).maybeSingle();
    clientId = client ? requestedClientId : null;
  }

  return proxyAgentStream("/flows/exercise-coach/stream", {
    question: body?.question ?? "",
    exercise: body?.exercise ?? {},
    mode: body?.mode === "caveat" ? "caveat" : "qa",
    client_id: clientId,
    // Clientless "General" mode has no client to resolve the trainer from — pass
    // the trainer directly so their UI-entered key is used (client viewers rely
    // on client_id instead).
    trainer_id: viewer.role === "trainer" ? viewer.userId : null,
    llm_model: body?.llm_model,
  });
}
