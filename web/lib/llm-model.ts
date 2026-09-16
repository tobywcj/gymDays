// Global LLM model selection (trainer-facing). One model is chosen in the
// dashboard header and every AI feature uses it — there is no per-feature model
// picker. The choice is stored in a cookie so server routes can resolve it
// without the client having to send `llm_model` on each call.
//
// Framework-agnostic on purpose — safe to import in both server and client
// components. Server-side reads live in lib/llm-server.ts; client-side state
// lives in lib/llm-context.tsx.

export const LLM_MODEL_COOKIE = "llm_model";

// Shape returned by the AI service's /llms endpoint (see lib/ai-service.ts).
export type LlmCatalog = {
  default: string;
  models: Record<string, string>;
  keys: { openai: boolean; anthropic: boolean; google: boolean };
};

/** True when the given model id's provider has an API key configured. */
export function modelEnabled(id: string, keys: LlmCatalog["keys"]): boolean {
  switch (id.split("/")[0]) {
    case "openai":    return keys.openai;
    case "anthropic": return keys.anthropic;
    case "gemini":    return keys.google;  // Gemini/Gemma — the free default
    default:          return true;          // unknown/keyless providers stay selectable
  }
}

/** Compact header label — drops the "Provider · " prefix the catalog carries. */
export function modelShortLabel(label: string): string {
  const i = label.indexOf("·");
  return (i === -1 ? label : label.slice(i + 1)).trim();
}

/** A model is "paid" (bring-your-own key) when it isn't the free Gemini/Gemma tier. */
export function isPaidModel(id: string): boolean {
  return id.split("/")[0] !== "gemini";
}

// Preference order for the one-click paid fallback: cheapest first, so an
// accidental fallback costs the least. Only ids the trainer has a key for
// (modelEnabled) are eligible; the first match wins.
const PAID_FALLBACK_ORDER = [
  "anthropic/claude-haiku-4-5-20251001",
  "openai/gpt-4o-mini",
  "openai/gpt-4.1-mini",
  "anthropic/claude-sonnet-5",
  "openai/gpt-4o",
  "anthropic/claude-opus-5",
  "anthropic/claude-fable-5",
];

/** Cheapest paid model the trainer can actually use, or null if none. */
export function firstPaidModel(catalog: LlmCatalog | null): string | null {
  if (!catalog) return null;
  for (const id of PAID_FALLBACK_ORDER) {
    if (catalog.models[id] && modelEnabled(id, catalog.keys)) return id;
  }
  // Fall back to any enabled non-gemini model present in the catalog.
  for (const id of Object.keys(catalog.models)) {
    if (isPaidModel(id) && modelEnabled(id, catalog.keys)) return id;
  }
  return null;
}
