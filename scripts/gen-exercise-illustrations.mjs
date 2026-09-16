// Generate AI anatomical illustrations for each exercise in exercise_db and
// store them in the public `exercise-illustrations` bucket, then set
// exercise_db.illustration_url. The Programme cards prefer this illustration as
// the primary visual (target muscle group, posed in the movement) and fall back
// to the interactive MuscleMap when it's null.
//
// Prereqs: run migration 0032 first (adds the column + bucket).
//
// Providers (pick with --provider). Recommended free path: cloudflare.
//   cloudflare    FREE tier (~hundreds/day). @cf/black-forest-labs/flux-1-schnell.
//                 Needs CF_ACCOUNT_ID + CF_API_TOKEN (free Cloudflare account). Default.
//   huggingface   FREE tier. black-forest-labs/FLUX.1-schnell. Needs HF_TOKEN
//                 (free at huggingface.co/settings/tokens).
//   pollinations  FREE but rate-limited; reliable use needs a free token from
//                 enter.pollinations.ai → set POLLINATIONS_TOKEN.
//   openai        PAID. gpt-image-1. Needs OPENAI_API_KEY. Best anatomy quality.
//
// Usage (from the web/ directory so @supabase/supabase-js resolves):
//   cd web
//   # FREE (recommended) — Cloudflare Workers AI:
//   CF_ACCOUNT_ID=... CF_API_TOKEN=... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node ../scripts/gen-exercise-illustrations.mjs --limit 3
//   # FREE — Hugging Face:
//   HF_TOKEN=hf_... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node ../scripts/gen-exercise-illustrations.mjs --provider huggingface
//   # PAID — OpenAI:
//   OPENAI_API_KEY=sk-... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node ../scripts/gen-exercise-illustrations.mjs --provider openai
//
// --force regenerates exercises that already have an illustration_url.
// --delay <ms> waits between exercises (default 1200) to respect rate limits.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const FORCE = flag("--force");
const LIMIT = Number(opt("--limit", "0")) || 0;
const PROVIDER = opt("--provider", "openai");
const DELAY = Number(opt("--delay", "1200")) || 0;
const SIZE = opt("--size", "1024x1024");
const BUCKET = "exercise-illustrations";
const [W, H] = SIZE.split("x").map(Number);

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function prompt(ex) {
  const primary = (ex.primary_muscles || []).join(", ") || ex.muscle_group || "the target muscles";
  const secondary = (ex.secondary_muscles || []).join(", ");
  return [
    `Clean flat medical-style anatomical illustration of a single human figure performing the "${ex.name}" exercise`,
    ex.equipment && ex.equipment !== "bodyweight" ? `using ${ex.equipment}` : "",
    `shown mid-movement in correct form.`,
    ex.cues ? `Form: ${ex.cues}.` : "",
    `Render the body as a light grey muscular anatomy figure on a plain white background.`,
    `Highlight the PRIMARY working muscles (${primary}) in bright red.`,
    secondary ? `Shade the secondary muscles (${secondary}) in light orange.` : "",
    `Front or three-quarter view, full body in frame, centered, no text, no labels, no equipment branding, no background scenery.`,
  ].filter(Boolean).join(" ");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// FREE tier: image.pollinations.ai (FLUX). Anonymous is heavily rate-limited;
// set POLLINATIONS_TOKEN (free, from enter.pollinations.ai) for reliable use.
async function genPollinations(ex) {
  const seed = Math.floor(Math.random() * 1e9);
  const tok = process.env.POLLINATIONS_TOKEN;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt(ex))}`
    + `?width=${W}&height=${H}&nologo=true&model=flux&seed=${seed}${tok ? `&token=${tok}` : ""}`;
  const res = await fetch(url, tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
  if (!res.ok) throw new Error(`Pollinations ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return Buffer.from(await res.arrayBuffer());
}

// FREE tier: Hugging Face Inference API, FLUX.1-schnell. Returns image bytes;
// 503 with estimated_time means the model is warming up — we back off + retry.
async function genHuggingface(ex) {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error("Set HF_TOKEN for --provider huggingface");
  const res = await fetch("https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: prompt(ex) }),
  });
  if (res.status === 503) {
    const j = await res.json().catch(() => ({}));
    throw new Error(`HF warming up (${Math.ceil(j.estimated_time || 20)}s) — rerun shortly`);
  }
  if (!res.ok) throw new Error(`HuggingFace ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return Buffer.from(await res.arrayBuffer());
}

// FREE tier: Cloudflare Workers AI flux-1-schnell. Returns base64 JPEG.
async function genCloudflare(ex) {
  const acct = process.env.CF_ACCOUNT_ID, token = process.env.CF_API_TOKEN;
  if (!acct || !token) throw new Error("Set CF_ACCOUNT_ID and CF_API_TOKEN for --provider cloudflare");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt(ex), steps: 6 }),
  });
  if (!res.ok) throw new Error(`Cloudflare ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  const b64 = data?.result?.image;
  if (!b64) throw new Error("No image in Cloudflare response");
  return Buffer.from(b64, "base64");
}

// PAID: OpenAI gpt-image-1. Returns base64 PNG.
async function genOpenAI(ex) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Set OPENAI_API_KEY for --provider openai");
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "gpt-image-1", prompt: prompt(ex), size: SIZE, n: 1 }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image returned");
  return Buffer.from(b64, "base64");
}

const PROVIDERS = { cloudflare: genCloudflare, huggingface: genHuggingface, pollinations: genPollinations, openai: genOpenAI };
const generate = PROVIDERS[PROVIDER];
if (!generate) { console.error(`Unknown --provider "${PROVIDER}". Use: cloudflare | huggingface | pollinations | openai`); process.exit(1); }

// Retry transient rate-limit / warm-up errors with exponential backoff.
async function generateWithRetry(ex, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { return await generate(ex); }
    catch (e) {
      if (i === tries - 1) throw e;
      const wait = 3000 * (i + 1);
      process.stdout.write(`retry in ${wait / 1000}s (${e.message.slice(0, 60)}) … `);
      await sleep(wait);
    }
  }
}

async function main() {
  let q = sb.from("exercise_db").select("id, name, name_zh, muscle_group, primary_muscles, secondary_muscles, cues, equipment, illustration_url").order("name");
  const { data: rows, error } = await q;
  if (error) throw error;

  let todo = (rows || []).filter((r) => FORCE || !r.illustration_url);
  if (LIMIT) todo = todo.slice(0, LIMIT);
  console.log(`${todo.length} exercise(s) to illustrate (provider=${PROVIDER}, size=${SIZE}, force=${FORCE}).`);

  let ok = 0, fail = 0;
  for (const ex of todo) {
    try {
      process.stdout.write(`• ${ex.name} … `);
      const png = await generateWithRetry(ex);
      const path = `${ex.id}.png`;
      const up = await sb.storage.from(BUCKET).upload(path, png, { contentType: "image/png", upsert: true });
      if (up.error) throw up.error;
      const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const { error: ue } = await sb.from("exercise_db").update({ illustration_url: url }).eq("id", ex.id);
      if (ue) throw ue;
      console.log("done");
      ok++;
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      fail++;
    }
    if (DELAY) await sleep(DELAY);
  }
  console.log(`\nFinished: ${ok} generated, ${fail} failed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
