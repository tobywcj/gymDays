import type { SupabaseClient } from "@supabase/supabase-js";

// Recompute the canonical clients.injury_history from the trail after any
// create/edit/delete. The trainer's latest entry is authoritative; if there are
// no trainer entries (only the client's screening self-report), fall back to the
// latest entry. This keeps the one column the whole app reads in sync with the
// editable trail. Call with a trainer-scoped supabase client (RLS enforced).
export async function recomputeInjuryHistory(supabase: SupabaseClient, clientId: string): Promise<string | null> {
  const { data } = await supabase
    .from("client_injury_log")
    .select("note, source, created_at, resolved_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  // Resolved entries are closed — they don't define the current official status.
  const entries = ((data ?? []) as { note: string | null; source: string; resolved_at: string | null }[])
    .filter((e) => !e.resolved_at);
  const latestTrainer = entries.find((e) => e.source === "trainer");
  // If an active trainer entry exists, honour it (even when cleared to null).
  // Otherwise use the most recent active entry (the client's self-report).
  const canonical = latestTrainer ? latestTrainer.note : (entries[0]?.note ?? null);

  await supabase.from("clients").update({ injury_history: canonical }).eq("id", clientId);
  return canonical;
}
