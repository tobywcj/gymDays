// Per-trainer secret keys (bring-your-own API keys).
//   GET    /api/secrets         — list this trainer's secrets (values masked).
//   POST   /api/secrets         — upsert a secret { key, value, label? }.
//   DELETE /api/secrets?key=…    — remove a secret by key.
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

function mask(value: string): string {
  return value.length > 4 ? `…${value.slice(-4)}` : "…";
}

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("trainer_secrets")
    .select("key, value, label, created_at, updated_at")
    .eq("trainer_id", user.id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const secrets = (data ?? []).map((row) => ({
    key: row.key,
    masked: mask(row.value as string),
    label: row.label,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  return NextResponse.json({ secrets });
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  const value = typeof body?.value === "string" ? body.value : "";
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim() : null;
  if (!key) return NextResponse.json({ error: "key required" }, { status: 422 });
  if (!value) return NextResponse.json({ error: "value required" }, { status: 422 });

  const { error } = await supabase
    .from("trainer_secrets")
    .upsert(
      { trainer_id: user.id, key, value, label, updated_at: new Date().toISOString() },
      { onConflict: "trainer_id,key" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ saved: true, key });
}

export async function DELETE(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 422 });

  const { error } = await supabase
    .from("trainer_secrets")
    .delete()
    .eq("trainer_id", user.id)
    .eq("key", key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deleted: true, key });
}
