// Daily incremental sync for all connected clients.
// Called by pg_cron at midnight; protected by CRON_SECRET header.
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { cronSecret, cronSecretMatches } from "@/lib/cron-secret";

export async function POST(req: NextRequest) {
  if (!cronSecretMatches(req.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const origin = req.nextUrl.origin;

  // Find all clients with an active Strava token
  const { data: tokens } = await admin
    .from("integration_tokens")
    .select("client_id")
    .eq("provider", "strava");

  if (!tokens || tokens.length === 0) {
    return NextResponse.json({ synced: 0 });
  }

  const results: Array<{ client_id: string; pulled?: number; error?: string }> = [];

  for (const { client_id } of tokens) {
    try {
      const r = await fetch(`${origin}/api/strava/sync/${client_id}`, {
        method: "POST",
        headers: { "x-internal-secret": cronSecret() },
      });
      if (!r.ok) {
        results.push({ client_id, error: `${r.status}` });
      } else {
        const j = (await r.json()) as { pulled: number };
        results.push({ client_id, pulled: j.pulled });
      }
    } catch (e) {
      results.push({ client_id, error: (e as Error).message });
    }
  }

  const totalPulled = results.reduce((s, r) => s + (r.pulled ?? 0), 0);
  return NextResponse.json({ synced: tokens.length, total_pulled: totalPulled, results });
}
