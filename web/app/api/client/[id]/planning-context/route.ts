import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth/viewer";
import { fetchClientHealth } from "@/lib/client-health";

export const dynamic = "force-dynamic";

// Background the trainer toggles as Step 1 of planning a program: the client's
// active injuries + screening-derived safety considerations. The planner card
// renders these as toggle chips and sends the kept ones back as `constraints`.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (viewer.role === "none") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (viewer.role === "client" && !viewer.clientIds.includes(id)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = await supabaseServer();
  let health: Awaited<ReturnType<typeof fetchClientHealth>> = null;
  try {
    health = await fetchClientHealth(supabase, id);
  } catch (e) {
    return NextResponse.json({ error: "context_unavailable", detail: (e as Error).message }, { status: 500 });
  }

  const injuries = (health?.injuryHistory ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  const screening: string[] = [];
  if (health?.medicalClearanceRequired) {
    screening.push("Medical clearance required — cap intensity at RPE 7, no max-effort tests");
  }
  if ((health?.cvdRiskFactorCount ?? 0) >= 2) {
    screening.push(`${health!.cvdRiskFactorCount} CVD risk factors — sub-max cardio only`);
  }
  if (health?.betaBlockers) {
    screening.push("Beta-blockers — anchor cardio with RPE targets (13–15), not HR zones");
  }

  return NextResponse.json({ injuries, screening });
}
