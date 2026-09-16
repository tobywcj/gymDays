import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

const AI_BASE = process.env.AI_SERVICE_URL || "http://localhost:8001";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Ownership check: doc belongs to this trainer
  const { data: doc } = await supabase
    .from("knowledge_docs")
    .select("id")
    .eq("id", id)
    .eq("trainer_id", user.id)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const r = await fetch(`${AI_BASE}/knowledge/docs/${id}/chunks`, { cache: "no-store" });
    const data = await r.json();
    if (!r.ok) return NextResponse.json(data, { status: r.status });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
