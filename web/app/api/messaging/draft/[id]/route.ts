import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { draftMessage } from "@/lib/ai-service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: client } = await supabase
    .from("clients").select("id").eq("id", id).maybeSingle();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const channel = body?.channel ? String(body.channel) : "telegram";
  const brief = body?.brief ? String(body.brief) : undefined;

  try {
    return NextResponse.json(await draftMessage(id, channel, brief));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
