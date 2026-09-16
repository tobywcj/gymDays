// Returns the configured Telegram bot's @username (for building deep links).
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

const BASE = process.env.AI_SERVICE_URL || "http://localhost:8001";

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const r = await fetch(`${BASE}/messaging/telegram/bot-info?trainer_id=${encodeURIComponent(user.id)}`, { cache: "no-store" });
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json({ configured: false, detail: "ai_service_unreachable" });
  }
}
