import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params;
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("messages")
    .select("id, direction, channel, body, status, sent_at")
    .eq("client_id", clientId)
    .order("sent_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
