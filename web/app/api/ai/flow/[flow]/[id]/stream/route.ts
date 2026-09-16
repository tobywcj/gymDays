import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { proxyAgentStream } from "@/lib/ai-stream";

export const dynamic = "force-dynamic";

const ALLOWED = ["daily-reminder", "weekly-checkin", "post-session-nudge"];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ flow: string; id: string }> },
) {
  const { flow, id } = await params;
  if (!ALLOWED.includes(flow)) {
    return NextResponse.json({ error: "unknown_flow" }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: client } = await supabase
    .from("clients").select("id").eq("id", id).maybeSingle();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  return proxyAgentStream(`/flows/${flow}/${id}/stream`, {
    llm_model: body?.llm_model,
  });
}
