// POST /api/connections/<provider> — save credentials (after optional live test).
// DELETE /api/connections/<provider> — remove credentials for this trainer.
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

const BASE = process.env.AI_SERVICE_URL || "http://localhost:8001";
const KNOWN = new Set(["telegram", "email"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!KNOWN.has(provider)) return NextResponse.json({ error: "unknown_provider" }, { status: 400 });

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const credentials = body?.credentials as Record<string, string> | undefined;
  const skipTest = !!body?.skip_test;
  if (!credentials || typeof credentials !== "object") {
    return NextResponse.json({ error: "credentials required" }, { status: 422 });
  }

  // 1. Live-test (unless explicitly skipped).
  if (!skipTest) {
    try {
      const r = await fetch(`${BASE}/messaging/test-credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, credentials }),
      });
      const j = (await r.json()) as { ok: boolean; detail?: string };
      if (!j.ok) {
        return NextResponse.json({ error: "test_failed", detail: j.detail }, { status: 422 });
      }
    } catch (e) {
      return NextResponse.json(
        { error: "ai_service_unreachable", detail: (e as Error).message },
        { status: 502 },
      );
    }
  }

  // 2. Upsert (RLS scopes by auth.uid()).
  const { error } = await supabase
    .from("messaging_credentials")
    .upsert({
      trainer_id: user.id,
      provider,
      credentials,
      status: "connected",
      last_tested_at: skipTest ? null : new Date().toISOString(),
    }, { onConflict: "trainer_id,provider" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ connected: true, provider });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!KNOWN.has(provider)) return NextResponse.json({ error: "unknown_provider" }, { status: 400 });

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("messaging_credentials")
    .delete()
    .eq("trainer_id", user.id)
    .eq("provider", provider);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ disconnected: true, provider });
}
