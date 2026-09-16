import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { sendMessage } from "@/lib/ai-service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: client } = await supabase
    .from("clients").select("id").eq("id", id).maybeSingle();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const text = String(body?.body ?? "").trim();
  const provider = body?.provider ? String(body.provider) : undefined;
  const subject = body?.subject ? String(body.subject) : undefined;
  const to = body?.to ? String(body.to) : undefined;
  if (!text) return NextResponse.json({ error: "body_required" }, { status: 422 });

  try {
    return NextResponse.json(await sendMessage(id, text, provider, subject, to));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
