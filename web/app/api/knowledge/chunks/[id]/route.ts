import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

const AI_BASE = process.env.AI_SERVICE_URL || "http://localhost:8001";

// Confirm the chunk belongs to the signed-in trainer before mutating it.
async function ownsChunk(id: string): Promise<{ ok: boolean; status: number }> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };
  const { data: chunk } = await supabase
    .from("knowledge_chunks").select("id").eq("id", id).eq("trainer_id", user.id).maybeSingle();
  return { ok: !!chunk, status: chunk ? 200 : 404 };
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const own = await ownsChunk(id);
  if (!own.ok) return NextResponse.json({ error: own.status === 401 ? "unauthorized" : "not_found" }, { status: own.status });

  try {
    const r = await fetch(`${AI_BASE}/knowledge/chunks/${id}`, { method: "DELETE" });
    const data = await r.json();
    if (!r.ok) return NextResponse.json(data, { status: r.status });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const own = await ownsChunk(id);
  if (!own.ok) return NextResponse.json({ error: own.status === 401 ? "unauthorized" : "not_found" }, { status: own.status });

  const body = await req.json().catch(() => ({}));
  try {
    const r = await fetch(`${AI_BASE}/knowledge/chunks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) return NextResponse.json(data, { status: r.status });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
