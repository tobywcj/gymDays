// Shared secret for server-to-server calls: pg_cron hits the dispatch routes
// with `x-cron-secret`, and routes fan out to each other with
// `x-internal-secret`. Both carry the value of CRON_SECRET.
//
// Fails closed. With CRON_SECRET unset every such request is rejected rather
// than falling back to a default, so a missing env var can't leave the cron
// endpoints open to anyone who has read this file.
import { createHash, timingSafeEqual } from "node:crypto";

export function cronSecretMatches(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("CRON_SECRET is not set — rejecting internal request.");
    return false;
  }
  if (!header) return false;
  // Hash both sides first so the compare is constant-time and length-agnostic.
  return timingSafeEqual(
    createHash("sha256").update(header).digest(),
    createHash("sha256").update(secret).digest(),
  );
}

// The outbound value, for routes that fan out to each other with
// `x-internal-secret`. Callers reach this only after cronSecretMatches() has
// accepted the incoming request, so CRON_SECRET is set by then.
export function cronSecret(): string {
  return process.env.CRON_SECRET ?? "";
}
