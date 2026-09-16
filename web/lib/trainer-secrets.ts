// Shared server helper: resolve bring-your-own API keys. Trainers save keys in
// the API-key sidebar (→ trainer_secrets); features read them here, falling back
// to the process env so a globally-configured key still works.
//
// SERVER-ONLY: returns plaintext secret values. Never import into client code.
import type { SupabaseClient } from "@supabase/supabase-js";

export type SecretMap = Record<string, string>;

/** Load a trainer's stored secrets as a { key: value } map. RLS scopes access. */
export async function getTrainerSecrets(
  supabase: SupabaseClient,
  trainerId: string,
): Promise<SecretMap> {
  const { data } = await supabase
    .from("trainer_secrets")
    .select("key, value")
    .eq("trainer_id", trainerId);
  const map: SecretMap = {};
  for (const row of data ?? []) {
    if (row.key && row.value) map[row.key as string] = row.value as string;
  }
  return map;
}

/** Resolve a single secret: trainer-stored value first, then process env. */
export function resolveSecret(secrets: SecretMap | undefined, key: string): string | undefined {
  return secrets?.[key] || process.env[key] || undefined;
}
