import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { runOnboarding } from "@/lib/ai-service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Confirm the client belongs to this trainer.
  const { data: client } = await supabase
    .from("clients").select("id").eq("id", id).single();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json();
  const transcript = String(body.transcript ?? "").trim();
  const llm_model = body.llm_model ? String(body.llm_model) : undefined;
  if (!transcript) return NextResponse.json({ error: "transcript_required" }, { status: 422 });

  try {
    const result = await runOnboarding(id, transcript, llm_model);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
