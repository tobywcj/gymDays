import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

type ExerciseItem = { exercise_id: string; sets?: string | number; reps?: string | number; notes?: string; order?: number };

// Trainer-only: create a scheduled session. RLS (sessions_owner) enforces
// trainer_id = auth.uid(); the client portal reads the same row (read-only).
export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const clientId = body?.client_id ? String(body.client_id) : null;
  const scheduledAt = body?.scheduled_at ? String(body.scheduled_at) : null;
  const exercises: ExerciseItem[] = Array.isArray(body?.exercises) ? body.exercises : [];

  if (!clientId || !scheduledAt) return NextResponse.json({ error: "client_id and scheduled_at required" }, { status: 400 });
  if (exercises.length === 0) return NextResponse.json({ error: "at least one exercise required" }, { status: 400 });

  // Ownership: the client must belong to this trainer (RLS already scopes, but
  // verify so we return a clean 403 rather than an RLS insert failure).
  const { data: client } = await supabase
    .from("clients").select("id").eq("id", clientId).eq("trainer_id", user.id).maybeSingle();
  if (!client) return NextResponse.json({ error: "client_not_found" }, { status: 404 });

  // Validate referenced exercise ids exist (global catalog).
  const ids = Array.from(new Set(exercises.map((e) => e.exercise_id).filter(Boolean)));
  const { data: found } = await supabase.from("exercise_db").select("id").in("id", ids);
  const foundSet = new Set((found ?? []).map((r) => r.id as string));
  const missing = ids.filter((i) => !foundSet.has(i));
  if (missing.length) return NextResponse.json({ error: `unknown exercise ids: ${missing.join(", ")}` }, { status: 400 });

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      trainer_id: user.id,
      client_id: clientId,
      scheduled_at: scheduledAt,
      duration_min: body?.duration_min ?? null,
      title: body?.title ?? null,
      focus: body?.focus ?? null,
      exercises,
      status: "scheduled",
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.id });
}
