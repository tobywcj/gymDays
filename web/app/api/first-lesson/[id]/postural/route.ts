import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

type Body = {
  upper_crossed: string;
  upper_crossed_notes: string;
  lower_crossed: string;
  lower_crossed_notes: string;
  pronation_distortion: string;
  pronation_distortion_notes: string;
  scoliosis: string;
  scoliosis_notes: string;
  overhead_squat: { result: string; notes: string };
  hip_hinge: { result: string; notes: string };
  single_leg_squat: { result: string; notes: string };
  wall_angel: { result: string; notes: string };
  summary?: string;
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;

  const { error } = await supabase
    .from("postural_assessments")
    .insert({
      trainer_id: user.id,
      client_id: id,
      upper_crossed: body.upper_crossed || "none",
      upper_crossed_notes: body.upper_crossed_notes || null,
      lower_crossed: body.lower_crossed || "none",
      lower_crossed_notes: body.lower_crossed_notes || null,
      pronation_distortion: body.pronation_distortion || "none",
      pronation_distortion_notes: body.pronation_distortion_notes || null,
      scoliosis: body.scoliosis || "none",
      scoliosis_notes: body.scoliosis_notes || null,
      overhead_squat: body.overhead_squat ?? {},
      hip_hinge: body.hip_hinge ?? {},
      single_leg_squat: body.single_leg_squat ?? {},
      wall_angel: body.wall_angel ?? {},
      summary: body.summary || null,
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
