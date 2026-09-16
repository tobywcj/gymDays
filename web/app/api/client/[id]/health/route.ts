import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchClientHealth } from "@/lib/client-health";

// Lightweight suitability inputs for the Programme caveat badge. RLS limits the
// rows to clients the viewer may see (trainer: own clients; client: themselves).
// Delegates to fetchClientHealth so the badge weighs the WHOLE unresolved injury
// trail (client_injury_log active notes), not just the latest official status —
// mirroring the POST /caveats path so both surfaces agree.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // A data-source failure must surface as an error, not silently clear safety
  // flags (which would label every exercise "suitable" for an injured client).
  let health;
  try {
    health = await fetchClientHealth(supabase, id);
  } catch (e) {
    return NextResponse.json({ error: "health_unavailable", detail: (e as Error).message }, { status: 500 });
  }
  if (!health) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(health);
}
