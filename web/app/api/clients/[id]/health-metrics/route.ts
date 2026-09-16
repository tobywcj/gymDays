import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Logs an ongoing InBody / BIA reading for a client (any time, not just intake).
// Mirrors the first-lesson vitals insert but marks the row source = 'session'.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const extraMetrics =
    body.extra_metrics && typeof body.extra_metrics === "object" && !Array.isArray(body.extra_metrics)
      ? (body.extra_metrics as Record<string, unknown>)
      : {};

  const num = (v: unknown) => (typeof v === "number" || typeof v === "string" ? v : null);

  const { error } = await supabase
    .from("client_health_metrics")
    .insert({
      trainer_id: user.id,
      client_id: id,
      source: "session",
      bp_systolic: num(body.bp_systolic),
      bp_diastolic: num(body.bp_diastolic),
      resting_hr: num(body.resting_hr),
      weight_kg: num(body.weight_kg),
      bmi: num(body.bmi),
      body_fat_pct: num(body.body_fat_pct),
      fat_free_mass_kg: num(body.fat_free_mass_kg),
      bmr_kcal: num(body.bmr_kcal),
      waist_hip_ratio: num(body.waist_hip_ratio),
      total_body_water_pct: num(body.total_body_water_pct),
      extra_metrics: extraMetrics,
      notes: (body.notes as string | null) ?? null,
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

// Deletes a single InBody / BIA reading. Scoped to the signed-in trainer's own
// clients (RLS enforces this too) via ?metricId=<uuid>.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const metricId = req.nextUrl.searchParams.get("metricId");
  if (!metricId) return NextResponse.json({ error: "metricId required" }, { status: 400 });

  const { error } = await supabase
    .from("client_health_metrics")
    .delete()
    .eq("id", metricId)
    .eq("client_id", id)
    .eq("trainer_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
