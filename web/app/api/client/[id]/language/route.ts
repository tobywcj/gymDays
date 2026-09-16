import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

const ALLOWED = new Set(["en", "zh"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { language } = (await req.json()) as { language?: string };
  if (!language || !ALLOWED.has(language)) {
    return NextResponse.json({ error: "invalid language" }, { status: 422 });
  }

  const { error } = await supabase
    .from("clients")
    .update({ language })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id, language });
}
