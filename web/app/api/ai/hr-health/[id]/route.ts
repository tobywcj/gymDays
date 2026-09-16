import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

const AI_BASE = process.env.AI_SERVICE_URL || "http://localhost:8001";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: client } = await supabase
    .from("clients").select("id").eq("id", id).maybeSingle();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const r = await fetch(`${AI_BASE}/flows/hr-health/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      llm_model:    body?.llm_model,
      weeks:        body?.weeks,
      period_start: body?.period_start,
      period_end:   body?.period_end,
    }),
  });
  if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: 502 });
  return NextResponse.json(await r.json());
}
