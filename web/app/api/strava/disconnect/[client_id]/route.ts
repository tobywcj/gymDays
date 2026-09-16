// Disconnect a client's Strava integration: delete the stored OAuth tokens
// and clear strava_athlete_id. Activities are kept — the client may have a
// history with prior tokens. Adjust if you'd rather drop them too.
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: NextRequest, { params }: { params: Promise<{ client_id: string }> }) {
  const { client_id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Verify trainer owns the client (RLS would block anyway, but fail fast here).
  const { data: client } = await supabase
    .from("clients").select("id").eq("id", client_id).maybeSingle();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const deleteActivities = body?.delete_activities === true;

  const admin = supabaseAdmin();
  await admin.from("integration_tokens")
    .delete()
    .eq("client_id", client_id)
    .eq("provider", "strava");
  await admin.from("clients")
    .update({ strava_athlete_id: null })
    .eq("id", client_id);

  let deletedActivities = 0;
  if (deleteActivities) {
    const { count } = await admin.from("activities")
      .delete({ count: "exact" })
      .eq("client_id", client_id)
      .eq("source", "strava");
    deletedActivities = count ?? 0;
  }

  return NextResponse.json({ disconnected: true, deletedActivities });
}
