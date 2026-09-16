import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { supabaseServer } from "@/lib/supabase/server";
import { proxyAgentStream } from "@/lib/ai-stream";

export const dynamic = "force-dynamic";

const BRANCHES = new Set([
  "health", "progress", "injuries", "knowledge",
  "stamina", "strength", "mental", "nutrition",
]);

// Expands one node of the client's "Understand your body" insight tree. The flow
// binds the client's own read-only data tools. Authorization: a client viewer is
// locked to their own client row (any provided id is ignored); a trainer may only
// pass a client they own (to preview the client's tree).
export async function POST(req: NextRequest) {
  const viewer = await getViewer();
  if (viewer.role === "none") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const branch = String(body?.branch ?? "");
  if (!BRANCHES.has(branch)) return NextResponse.json({ error: "bad branch" }, { status: 400 });

  let clientId: string | null = null;
  if (viewer.role === "client") {
    clientId = viewer.clientIds[0] ?? null;
  } else {
    // trainer: verify ownership before passing the id downstream
    const requestedClientId = body?.client_id ? String(body.client_id) : null;
    if (requestedClientId) {
      const supabase = await supabaseServer();
      const { data: client } = await supabase
        .from("clients").select("id").eq("id", requestedClientId).eq("trainer_id", viewer.userId).maybeSingle();
      clientId = client ? requestedClientId : null;
    }
  }
  if (!clientId) return NextResponse.json({ error: "no client" }, { status: 403 });

  const nodePath = Array.isArray(body?.node_path) ? body.node_path.map(String).slice(0, 12) : [];
  const depth = Math.min(3, Math.max(1, Number(body?.depth) || 1));

  return proxyAgentStream(`/flows/insight-tree/${clientId}/stream`, {
    branch,
    node_path: nodePath,
    node_label: body?.node_label ? String(body.node_label) : null,
    web_search: body?.web_search === true,
    depth,
    llm_model: body?.llm_model,
  });
}
