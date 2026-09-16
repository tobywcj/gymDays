// GET /api/connections — provider catalog (DB-aware) + trainer's saved creds (redacted).
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

const BASE = process.env.AI_SERVICE_URL || "http://localhost:8001";

type ProviderInfo = { channel: string; available: boolean; reason: string | null; source: string | null };

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Pull provider availability from AI service (env vars only).
  let providers: Record<string, ProviderInfo> = {};
  try {
    const r = await fetch(`${BASE}/messaging/providers?trainer_id=${encodeURIComponent(user.id)}`, { cache: "no-store" });
    if (r.ok) providers = ((await r.json()) as { providers: Record<string, ProviderInfo> }).providers;
  } catch { /* AI service down — empty catalog */ }

  // Pull this trainer's saved credentials (so we can mark which providers are
  // user-configured). We redact secret-y fields before returning.
  const { data: saved } = await supabase
    .from("messaging_credentials")
    .select("provider, credentials, status, last_tested_at, created_at")
    .eq("trainer_id", user.id);

  const redacted = (saved ?? []).map((row) => {
    const c = row.credentials as Record<string, unknown>;
    const safe: Record<string, string> = {};
    for (const [k, v] of Object.entries(c)) {
      const str = typeof v === "string" ? v : JSON.stringify(v);
      // Show only the last 4 chars of anything that looks like a secret.
      const isSecret = /token|secret|key/i.test(k);
      safe[k] = isSecret && str.length > 4 ? `…${str.slice(-4)}` : str;
    }
    return { ...row, credentials: safe };
  });

  return NextResponse.json({ providers, saved: redacted });
}
