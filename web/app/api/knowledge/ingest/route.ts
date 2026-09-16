import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

const AI_BASE = process.env.AI_SERVICE_URL || "http://localhost:8001";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: trainer } = await supabase
    .from("trainers").select("id").eq("id", user.id).maybeSingle();
  if (!trainer) return NextResponse.json({ error: "trainer_not_found" }, { status: 404 });

  // Parse the incoming multipart, rebuild it, and forward to the AI service.
  // We forward trainer_id as a query param (also as a form field for back-compat).
  let incomingForm: FormData;
  try {
    incomingForm = await req.formData();
  } catch (e) {
    return NextResponse.json({ error: `bad_form_data: ${(e as Error).message}` }, { status: 400 });
  }

  const forwarded = new FormData();
  for (const [key, value] of incomingForm.entries()) {
    forwarded.append(key, value);
  }
  forwarded.set("trainer_id", trainer.id);

  const url = `${AI_BASE}/knowledge/ingest?trainer_id=${encodeURIComponent(trainer.id)}`;
  try {
    const r = await fetch(url, { method: "POST", body: forwarded });
    const data = await r.json();
    if (!r.ok) return NextResponse.json(data, { status: r.status });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
