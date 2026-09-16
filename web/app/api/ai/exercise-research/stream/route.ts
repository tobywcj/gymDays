import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { proxyAgentStream } from "@/lib/ai-stream";

export const dynamic = "force-dynamic";

// Trainer-only: research a new exercise from a web query, URL, or pasted text.
// Returns a structured candidate the trainer reviews before adding to the DB.
export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: trainer } = await supabase
    .from("trainers").select("id").eq("id", user.id).maybeSingle();
  if (!trainer) return NextResponse.json({ error: "trainer_not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const query = body?.query ? String(body.query).slice(0, 500) : null;
  const url = body?.url ? String(body.url).slice(0, 2000) : null;
  const articleText = body?.article_text ? String(body.article_text).slice(0, 20000) : null;
  if (!query && !url && !articleText) {
    return NextResponse.json({ error: "query, url, or article_text required" }, { status: 400 });
  }

  return proxyAgentStream("/flows/exercise-research/stream", {
    query, url, article_text: articleText, llm_model: body?.llm_model,
    trainer_id: user.id,  // clientless flow — use the trainer's UI-entered key
  });
}
