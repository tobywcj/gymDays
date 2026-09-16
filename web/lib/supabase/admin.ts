// Service-role Supabase client. BYPASSES RLS. Use only in server-side code
// that has no user session (webhooks, scheduled jobs, admin scripts).
import { createClient } from "@supabase/supabase-js";

export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Supabase admin env vars missing");
  return createClient(url, key, { auth: { persistSession: false } });
}
