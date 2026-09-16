import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

const AI_BASE = process.env.AI_SERVICE_URL || "http://localhost:8001";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // App-UI locale: the AI service returns the learning bullets in this language
  // (cached translation, falling back to English). Defaults to English.
  const lang = req.nextUrl.searchParams.get("lang") || "en";

  try {
    const r = await fetch(`${AI_BASE}/knowledge/agents/${user.id}?lang=${encodeURIComponent(lang)}`, { cache: "no-store" });
    const data = await r.json();
    if (!r.ok) return NextResponse.json(data, { status: r.status });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
