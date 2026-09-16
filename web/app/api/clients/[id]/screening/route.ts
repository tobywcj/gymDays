import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Trainer-only: manually update the client's chronic conditions + medications
// (+ beta-blocker flag) on their latest screening. The PAR-Q / CVD parts and the
// previous-injury history are NOT touched here — injuries are owned by the injury
// log, and PAR-Q/CVD come from the client's own submission.
const CHRONIC_KEYS = ["hypertension", "diabetes", "asthma", "anemia"] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: client } = await supabase
    .from("clients").select("id").eq("id", id).eq("trainer_id", user.id).maybeSingle();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  // Sanitize: only the four known chronic flags, a bounded medication list, and
  // the beta-blocker boolean are accepted — everything else is ignored.
  const chronic: Record<string, boolean> = {};
  if (body?.chronic && typeof body.chronic === "object") {
    for (const k of CHRONIC_KEYS) chronic[k] = body.chronic[k] === true;
  }
  const medications = Array.isArray(body?.medications)
    ? (body.medications as unknown[])
        .filter((m): m is string => typeof m === "string")
        .map((m) => m.trim())
        .filter(Boolean)
        .slice(0, 50)
        .map((m) => m.slice(0, 200))
    : [];
  const beta_blockers = body?.beta_blockers === true;

  // Load the latest screening (if any) so we merge — never clobber PAR-Q / CVD /
  // previous_injuries / notes the client submitted.
  const { data: existing } = await supabase
    .from("client_screenings")
    .select("id, medical_history")
    .eq("client_id", id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevMed = (existing?.medical_history ?? {}) as Record<string, unknown>;
  const medical_history = { ...prevMed, chronic, medications, beta_blockers };

  if (existing) {
    const { error } = await supabase
      .from("client_screenings")
      .update({ medical_history, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    // No screening yet — create a minimal one so the trainer can record health
    // flags before/without the client's own PAR-Q submission.
    const { error } = await supabase
      .from("client_screenings")
      .insert({ trainer_id: user.id, client_id: id, medical_history });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, medical_history });
}
