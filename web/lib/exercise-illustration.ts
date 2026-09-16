// ============================================================================
// Server-side exercise illustration generation. Powers the in-app "Generate
// illustration" action (the provider is chosen from the Programme filter card).
// Mirrors scripts/gen-exercise-illustrations.mjs but callable from a route.
//
// SERVER-ONLY: reads provider secrets (trainer-stored keys first, then env).
// Never import into client code.
// ============================================================================
import { resolveSecret, type SecretMap } from "./trainer-secrets";

export type IllustrationProviderId = "cloudflare" | "huggingface" | "pollinations" | "openai";

export type ProviderInfo = {
  id: IllustrationProviderId;
  label: string;
  kind: "free" | "paid";
  ready: boolean; // credentials present (trainer secret or env)
};

type ExerciseLike = {
  name: string;
  muscle_group?: string | null;
  primary_muscles?: string[] | null;
  secondary_muscles?: string[] | null;
  cues?: string | null;
  equipment?: string | null;
};

/** Provider catalog + whether each is configured. Safe to expose to the client. */
export function illustrationProviders(secrets?: SecretMap): ProviderInfo[] {
  const has = (k: string) => !!resolveSecret(secrets, k);
  return [
    { id: "cloudflare", label: "Cloudflare FLUX", kind: "free", ready: has("CF_ACCOUNT_ID") && has("CF_API_TOKEN") },
    { id: "huggingface", label: "Hugging Face FLUX", kind: "free", ready: has("HF_TOKEN") },
    { id: "pollinations", label: "Pollinations", kind: "free", ready: true }, // works w/o key (rate-limited); POLLINATIONS_TOKEN optional
    { id: "openai", label: "OpenAI gpt-image-1", kind: "paid", ready: has("OPENAI_API_KEY") },
  ];
}

export function buildPrompt(ex: ExerciseLike): string {
  const primary = (ex.primary_muscles ?? []).join(", ") || ex.muscle_group || "the target muscles";
  const secondary = (ex.secondary_muscles ?? []).join(", ");
  return [
    `Clean flat medical-style anatomical illustration of a single human figure performing the "${ex.name}" exercise`,
    ex.equipment && ex.equipment !== "bodyweight" ? `using ${ex.equipment}` : "",
    `shown mid-movement in correct form.`,
    ex.cues ? `Form: ${ex.cues}.` : "",
    `Render the body as a light grey muscular anatomy figure on a plain white background.`,
    `Highlight the PRIMARY working muscles (${primary}) in bright red.`,
    secondary ? `Shade the secondary muscles (${secondary}) in light orange.` : "",
    `Front or three-quarter view, full body in frame, centered, no text, no labels, no background scenery.`,
  ].filter(Boolean).join(" ");
}

export type GeneratedImage = { bytes: Buffer; contentType: string };

async function genCloudflare(ex: ExerciseLike, secrets?: SecretMap): Promise<GeneratedImage> {
  const acct = resolveSecret(secrets, "CF_ACCOUNT_ID"), token = resolveSecret(secrets, "CF_API_TOKEN");
  if (!acct || !token) throw new Error("Cloudflare not configured (CF_ACCOUNT_ID, CF_API_TOKEN)");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: buildPrompt(ex), steps: 6 }),
  });
  if (!res.ok) throw new Error(`Cloudflare ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  const b64 = data?.result?.image;
  if (!b64) throw new Error("No image in Cloudflare response");
  return { bytes: Buffer.from(b64, "base64"), contentType: "image/jpeg" };
}

async function genHuggingface(ex: ExerciseLike, secrets?: SecretMap): Promise<GeneratedImage> {
  const token = resolveSecret(secrets, "HF_TOKEN");
  if (!token) throw new Error("Hugging Face not configured (HF_TOKEN)");
  // Routed via the HF Inference Providers router (the legacy api-inference host
  // was retired). Returns the image bytes directly.
  const res = await fetch("https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: buildPrompt(ex) }),
  });
  if (res.status === 503) {
    const j = await res.json().catch(() => ({}));
    throw new Error(`Hugging Face model warming up (~${Math.ceil(j.estimated_time || 20)}s) — try again shortly`);
  }
  if (!res.ok) throw new Error(`Hugging Face ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const ct = res.headers.get("content-type") || "image/jpeg";
  return { bytes: Buffer.from(await res.arrayBuffer()), contentType: ct.startsWith("image/") ? ct : "image/jpeg" };
}

async function genPollinations(ex: ExerciseLike, secrets?: SecretMap): Promise<GeneratedImage> {
  const tok = resolveSecret(secrets, "POLLINATIONS_TOKEN");
  const seed = Math.floor(Math.random() * 1e9);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(buildPrompt(ex))}`
    + `?width=1024&height=1024&nologo=true&model=flux&seed=${seed}${tok ? `&token=${tok}` : ""}`;
  const res = await fetch(url, tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
  if (!res.ok) throw new Error(`Pollinations ${res.status} (rate-limited — set POLLINATIONS_TOKEN): ${(await res.text()).slice(0, 120)}`);
  return { bytes: Buffer.from(await res.arrayBuffer()), contentType: "image/jpeg" };
}

async function genOpenAI(ex: ExerciseLike, secrets?: SecretMap): Promise<GeneratedImage> {
  const key = resolveSecret(secrets, "OPENAI_API_KEY");
  if (!key) throw new Error("OpenAI not configured (OPENAI_API_KEY)");
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "gpt-image-1", prompt: buildPrompt(ex), size: "1024x1024", n: 1 }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image returned");
  return { bytes: Buffer.from(b64, "base64"), contentType: "image/png" };
}

const GENERATORS: Record<IllustrationProviderId, (ex: ExerciseLike, secrets?: SecretMap) => Promise<GeneratedImage>> = {
  cloudflare: genCloudflare,
  huggingface: genHuggingface,
  pollinations: genPollinations,
  openai: genOpenAI,
};

export async function generateIllustration(provider: IllustrationProviderId, ex: ExerciseLike, secrets?: SecretMap): Promise<GeneratedImage> {
  const gen = GENERATORS[provider];
  if (!gen) throw new Error(`Unknown provider "${provider}"`);
  return gen(ex, secrets);
}
