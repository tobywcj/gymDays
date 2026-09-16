import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth/viewer";
import { runScreeningReadiness } from "@/lib/ai-service";

// Run the pre-training readiness agent for a client and return its verdict
// ("ready" | "alert") + rationale + flags. Trainer-initiated (spends LLM tokens),
// ephemeral (nothing persisted) — the verdict is always fresh against the current
// injury status + manually-edited chronic/medication flags.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (viewer.role === "none") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (viewer.role !== "trainer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const supabase = await supabaseServer();
  const { data: client } = await supabase
    .from("clients").select("id, trainer_id").eq("id", id).maybeSingle<{ id: string; trainer_id: string }>();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (client.trainer_id !== viewer.userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const llm_model = body?.llm_model ? String(body.llm_model) : undefined;

  try {
    const result = await runScreeningReadiness(id, llm_model);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
