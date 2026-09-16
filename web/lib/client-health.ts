// Shared server helper: derive the lightweight suitability inputs for a client
// from their row + latest screening. Used by the Programme pages (SSR) and the
// /api/client/[id]/health route. RLS on the passed supabase client scopes access.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientHealth } from "./exercise-suitability";

export async function fetchClientHealth(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ClientHealth | null> {
  const { data: client, error: clientErr } = await supabase
    .from("clients").select("id, injury_history").eq("id", clientId).maybeSingle();
  // A genuine query failure must NOT be swallowed — if we silently proceed with
  // empty health, every exercise reads as "suitable" and an injured client gets
  // unsafe recommendations. Throw so the caller surfaces an error instead.
  if (clientErr) throw new Error(`client-health: clients query failed — ${clientErr.message}`);
  if (!client) return null; // legitimately no such client

  // Caveat safety is CONSERVATIVE: weigh the client's WHOLE unresolved injury
  // history (every still-open note in client_injury_log) — not just the latest
  // official status — because any active injury can warrant caution on a movement.
  // We aggregate all active trail notes (deduped) into the text assessSuitability
  // keyword-matches. (The current official status for display stays on the card.)
  const { data: log } = await supabase
    .from("client_injury_log").select("note, resolved_at").eq("client_id", clientId);
  const rows = (log ?? []) as { note: string | null; resolved_at: string | null }[];
  // Trainer-resolved entries are excluded — a closed injury must stop flagging.
  // Use the trail's ACTIVE notes; only fall back to the canonical column when the
  // client has no trail rows at all (e.g. transcript-onboarded with none seeded).
  const activeNotes = rows.filter((r) => !r.resolved_at).map((r) => r.note);
  const candidates = rows.length > 0 ? activeNotes : [(client as { injury_history: string | null }).injury_history];
  const seen = new Set<string>();
  const injuryParts: string[] = [];
  for (const raw of candidates) {
    const v = (raw ?? "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    injuryParts.push(v);
  }
  const injuryHistory = injuryParts.length ? injuryParts.join("; ") : null;

  // The screening still owns the OTHER health flags (clearance / CVD / beta-blockers).
  const { data: screening, error: screeningErr } = await supabase
    .from("client_screenings")
    .select("medical_clearance_required, medical_history, cvd_risk")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // A broken screening read (e.g. a renamed column) is a data-source error, not
  // "this client is fine" — fail loud rather than silently clear safety flags.
  if (screeningErr) throw new Error(`client-health: screening query failed — ${screeningErr.message}`);
  // (screening === null with no error is fine — the client just hasn't filled one.)

  const cvd = (screening?.cvd_risk ?? {}) as Record<string, unknown>;
  const cvdRiskFactorCount = ["family_history", "smoking", "inactivity", "obesity"].reduce(
    (n, k) => n + (cvd[k] === true ? 1 : 0), 0,
  );
  const medicalHistory = (screening?.medical_history ?? {}) as Record<string, unknown>;
  const betaBlockers = medicalHistory["beta_blockers"] === true;

  return {
    injuryHistory,
    medicalClearanceRequired: screening?.medical_clearance_required ?? false,
    cvdRiskFactorCount,
    betaBlockers,
  };
}
