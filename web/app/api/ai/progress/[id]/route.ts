import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { runProgress } from "@/lib/ai-service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: client } = await supabase
    .from("clients").select("id").eq("id", id).maybeSingle();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const llm_model = body?.llm_model ? String(body.llm_model) : undefined;
  const days = body?.days ? Number(body.days) : undefined;
  const period_start = body?.period_start ? String(body.period_start) : undefined;
  const period_end   = body?.period_end   ? String(body.period_end)   : undefined;

  try {
    const result = await runProgress(id, llm_model, days, period_start, period_end);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
