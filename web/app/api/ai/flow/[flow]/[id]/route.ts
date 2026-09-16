import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { runMessagingFlow, type FlowName } from "@/lib/ai-service";

const ALLOWED: FlowName[] = ["daily-reminder", "weekly-checkin", "post-session-nudge"];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ flow: string; id: string }> },
) {
  const { flow, id } = await params;
  if (!(ALLOWED as string[]).includes(flow)) {
    return NextResponse.json({ error: "unknown_flow" }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: client } = await supabase
    .from("clients").select("id").eq("id", id).maybeSingle();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const llm_model = body?.llm_model ? String(body.llm_model) : undefined;

  try {
    return NextResponse.json(await runMessagingFlow(id, flow as FlowName, llm_model));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
