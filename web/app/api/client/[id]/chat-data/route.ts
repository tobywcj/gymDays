import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [progressResp, programResp, mealPlanResp] = await Promise.all([
    supabase
      .from("progress_reports")
      .select("id, period_start, period_end, summary, flags, created_at")
      .eq("client_id", id)
      .order("period_end", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("programs")
      .select("week_start, plan")
      .eq("client_id", id)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("meal_plans")
      .select("week_start, plan")
      .eq("client_id", id)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    progressReport: progressResp.data ?? null,
    program: programResp.data ?? null,
    mealPlan: mealPlanResp.data ?? null,
  });
}
