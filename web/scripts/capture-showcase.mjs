// Capture the README showcase assets — screenshots and short clips of the real
// running app, driven by Playwright against the demo roster seeded by
// scripts/seed-demo.mjs.
//
//   npm run showcase            # from the repo root (seeds, captures, converts)
//   node scripts/capture-showcase.mjs --only=dashboard,knowledge
//   node scripts/capture-showcase.mjs --no-clips
//
// Output lands in docs/media/. PNGs are captured at 2× and downscaled to a
// README-friendly width; clips record to .webm and ffmpeg converts them to GIF
// (GitHub's markdown sanitiser strips <video>, so GIF is what actually plays).
//
// Everything on screen is seeded demo data — no real client ever appears in a
// public asset.

import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import * as path from "node:path";

// ─── paths + env ────────────────────────────────────────────────────────────
const webRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(webRoot, "..");
const OUT = path.join(repoRoot, "docs", "media");
const RAW = path.join(repoRoot, "docs", "media", ".raw");

// Same precedence as tests/helpers/load-env.ts: a real env var wins, then
// web/.env.local, then the root .env. Hand-rolled to match the repo's tooling.
function loadEnvFile(file) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { return; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile(path.join(webRoot, ".env.local"));
loadEnvFile(path.join(repoRoot, ".env"));

const BASE = process.env.SHOWCASE_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? process.env.SEED_TEST_PASSWORD;
if (!PASSWORD) {
  console.error(
    "SEED_DEMO_PASSWORD (or SEED_TEST_PASSWORD) is not set.\n" +
      "scripts/seed-demo.mjs creates the showcase accounts with that value and this\n" +
      "script signs in with it, so the two have to agree. Add it to the root .env.",
  );
  process.exit(1);
}
const TRAINER = { email: "coach@demo.gymdays.local", password: PASSWORD };
const CLIENT = { email: "sarah@demo.gymdays.local", password: PASSWORD };

// ─── args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length)?.split(",").filter(Boolean) ?? null;
const withClips = !args.includes("--no-clips");
const headed = args.includes("--headed");
const wanted = (name) => !only || only.includes(name);

// ─── layout ─────────────────────────────────────────────────────────────────
const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2;              // retina capture…
const PNG_WIDTH = 1720;       // …downscaled to this for the README
const CLIP_SIZE = { width: 1280, height: 800 };

// ─── helpers ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ffmpeg(cmdArgs) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...cmdArgs], { stdio: "inherit" });
}

function haveFfmpeg() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
}

const kb = (file) => Math.round(statSync(file).size / 1024);

/** Capture `target` (a Locator, or the page for a viewport shot) to docs/media/<name>.png. */
async function shot(name, target, opts = {}) {
  const raw = path.join(RAW, `${name}.png`);
  if (target.screenshot) {
    await target.screenshot({ path: raw, animations: "disabled", ...opts });
  }
  const out = path.join(OUT, `${name}.png`);
  if (hasFfmpeg) {
    // Downscale the 2× capture; never upscale something already narrow.
    ffmpeg(["-i", raw, "-vf", `scale='min(${PNG_WIDTH},iw)':-2:flags=lanczos`, out]);
  } else {
    renameSync(raw, out);
  }
  console.log(`  ✓ ${name}.png (${kb(out)} KB)`);
}

/**
 * Shoot one panel. A panel taller than the viewport gets clipped at the top
 * edge when Playwright scrolls it into view, so grow the viewport to fit it
 * first and put it back afterwards.
 */
async function panelShot(page, name, selector) {
  const target = await panel(page, selector);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const vp = page.viewportSize();
  const needed = Math.min(Math.ceil((box?.height ?? 0) + 160), 6000);
  const grew = needed > vp.height;
  if (grew) {
    await page.setViewportSize({ width: vp.width, height: needed });
    await settle(page, 600);
    await target.scrollIntoViewIfNeeded();
    await sleep(300);
  }
  await shot(name, target);
  if (grew) {
    await page.setViewportSize(vp);
    await sleep(200);
  }
}

/**
 * Record an interaction to docs/media/<name>.gif.
 *
 * Playwright records from the moment the page opens, so the sign-in and the
 * page loads are in the file too — pure weight in a GIF. `run` is handed a
 * `mark()` to call once the interesting part is about to start, and everything
 * before it is trimmed off. `speed` then compresses a slow agent run into a
 * loop worth watching (3 = three times as fast).
 */
async function clip(browser, name, { speed = 1, fps = 10, width = 760, colors = 128, maxSeconds = 20, size = CLIP_SIZE, who = TRAINER, audience = "trainer", run }) {
  const dir = path.join(RAW, `video-${name}`);
  rmSync(dir, { recursive: true, force: true });
  // Deliberately NOT the shared session: several contexts replaying one saved
  // Supabase session race on refresh-token rotation, and the loser silently
  // lands back on /login — which is how a clip ends up being 50 seconds of the
  // sign-in page. Each clip signs in for itself, and mark() trims that away.
  const context = await newContext(browser, { recordVideo: { dir, size }, deviceScaleFactor: 1, viewport: size });
  const page = await context.newPage();
  const openedAt = Date.now();
  let markedAt = null;
  try {
    await signIn(page, who, audience);
    await run(page, () => { markedAt = Date.now(); });
    if (/\/login/.test(page.url())) throw new Error(`${name} ended on the login page — the session dropped mid-clip`);
  } finally {
    await page.close();
    await context.close();
  }
  const webm = readdirSync(dir).find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error(`no video recorded for ${name}`);
  const src = path.join(dir, webm);
  const out = path.join(OUT, `${name}.gif`);
  // Back off a beat from the mark so the clip opens on a settled frame.
  const trim = markedAt ? Math.max(0, (markedAt - openedAt) / 1000 - 0.6) : 0;
  const filters = [
    speed !== 1 ? `setpts=PTS/${speed}` : null,
    `fps=${fps}`,
    `scale=${width}:-2:flags=lanczos`,
  ].filter(Boolean).join(",");
  // Two-pass palette: one flat global palette bands badly on this dark UI.
  ffmpeg([
    ...(trim > 0 ? ["-ss", trim.toFixed(2)] : []),
    "-i", src,
    "-vf", `${filters},split[s0][s1];[s0]palettegen=max_colors=${colors}:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`,
    // Hard cap: a slow run must not quietly produce a 50-second GIF.
    "-t", String(maxSeconds),
    "-loop", "0", out,
  ]);
  console.log(`  ✓ ${name}.gif (${kb(out)} KB)`);
}

/**
 * A whole-page shot. Every page scrolls an inner container rather than the
 * document, so Playwright's fullPage just re-shoots the viewport — a very tall
 * viewport is what actually captures the lot.
 */
async function tallShot(browser, name, url, { who = TRAINER, audience = "trainer", height = 3200, settleMs = 2500 } = {}) {
  const { ctx, page: p } = await openAs(browser, who, audience, {
    viewport: { width: VIEWPORT.width, height }, deviceScaleFactor: 1,
  });
  try {
    await go(p, url);
    await settle(p, settleMs);
    await shot(name, p);
  } finally {
    await ctx.close();
  }
}

/**
 * Click an insight-tree branch and wait for the agent to grow it. The flow is a
 * live LLM call, so this waits on new nodes appearing rather than on a fixed
 * delay — and gives up quietly, leaving the collapsed tree to be captured.
 */
async function growInsight(page, label, timeoutMs = 120_000) {
  const nodes = page.locator(".glass div[title]");
  const before = await nodes.count();
  await page.locator(`div[title]:has-text("${label}")`).first().click();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await nodes.count()) > before) {
      await sleep(2500); // let the insight text and sources finish painting
      return true;
    }
    await sleep(1500);
  }
  console.log(`  – "${label}" did not grow within ${Math.round(timeoutMs / 1000)}s`);
  return false;
}

/**
 * Navigate. The client record fires a dozen parallel queries plus two AI-service
 * round trips, which on a dev server regularly outruns Playwright's 30s "load";
 * `settle()` is what actually waits for the page to be ready, so this only needs
 * the document.
 */
const go = (page, url) => page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });

/** A context pinned to English — the app itself defaults to 繁中. */
async function newContext(browser, extra = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: "dark",
    ...extra,
  });
  await context.addCookies([{ name: "app_lang", value: "en", url: BASE }]);
  return context;
}

/**
 * `audience` picks the landing page: trainers go to the dashboard, clients to
 * the portal. A bat flies across the screen before the redirect, so this waits
 * on the URL rather than on the click.
 *
 * Retried once: a capture run opens a dozen contexts, and the odd sign-in comes
 * back "Failed to fetch" when the auth endpoint is briefly unhappy.
 */
async function signIn(page, who, audience = "trainer", attempt = 1) {
  await go(page, `${BASE}/login`);
  if (audience === "client") await page.getByTestId("audience-client").click();
  await page.getByTestId("mode-password").click();
  await page.getByTestId("email").fill(who.email);
  await page.getByTestId("password").fill(who.password);
  await page.getByTestId("submit").click();
  try {
    await page.waitForURL(audience === "client" ? /\/portal/ : /localhost:\d+\/$/, { timeout: 30_000 });
  } catch {
    // The page reports auth failures inline; surface that instead of a bare timeout.
    const msg = (await page.getByTestId("status").first().textContent().catch(() => null))?.trim();
    if (attempt < 3) {
      console.log(`  – sign-in retry ${attempt} for ${who.email}${msg ? ` (${msg})` : ""}`);
      await sleep(3000 * attempt);
      return signIn(page, who, audience, attempt + 1);
    }
    throw new Error(`sign-in as ${who.email} did not land (${page.url()})${msg ? ` — ${msg}` : ""}`);
  }
  await page.waitForLoadState("networkidle").catch(() => {});
}

// One sign-in per account for the whole run: every later context is handed the
// saved session instead of going through the login form again. Fewer auth round
// trips means a faster run and far fewer transient failures.
const sessions = new Map();

async function sessionFor(browser, who, audience) {
  const key = `${who.email}:${audience}`;
  if (sessions.has(key)) return sessions.get(key);
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  try {
    await signIn(page, who, audience);
    const state = await ctx.storageState();
    sessions.set(key, state);
    return state;
  } finally {
    await ctx.close();
  }
}

/** A signed-in context + page, reusing the saved session. */
async function openAs(browser, who, audience = "trainer", extra = {}) {
  const storageState = await sessionFor(browser, who, audience);
  const ctx = await newContext(browser, { storageState, ...extra });
  return { ctx, page: await ctx.newPage() };
}

/**
 * The glass card that frames `selector` — how most panels are built. Some
 * components carry the testid on the card itself, so fall back to the element.
 */
async function panel(page, selector) {
  const card = page.locator(`.glass:has(${selector})`).first();
  if (await card.count()) return card;
  return page.locator(selector).first();
}

/** Let charts finish animating and lazy panels settle before the shutter. */
async function settle(page, ms = 1200) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(ms);
}

/**
 * Resolve a demo client's row id by clicking their roster row — the rows are
 * click handlers, not links, so there is no href to read.
 */
async function clientIdByName(page, name) {
  await go(page, `${BASE}/clients`);
  await settle(page, 400);
  await page.locator('[data-testid="client-row"]', { hasText: name }).first().click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/, { timeout: 15_000 });
  const id = page.url().match(/clients\/([0-9a-f-]{36})/)?.[1];
  if (!id) throw new Error(`could not resolve a client id for "${name}"`);
  return id;
}

// ─── run ────────────────────────────────────────────────────────────────────
const hasFfmpeg = haveFfmpeg();
if (!hasFfmpeg) console.warn("! ffmpeg not found — PNGs stay at 2× and clips are skipped");

mkdirSync(OUT, { recursive: true });
mkdirSync(RAW, { recursive: true });

const browser = await chromium.launch({ headless: !headed });
let context;

try {
  // ── public pages ──────────────────────────────────────────────────────────
  // Signed out, or /login just bounces to the dashboard.
  if (wanted("login")) {
    console.log("login");
    const anon = await newContext(browser);
    const p = await anon.newPage();
    await go(p, `${BASE}/login`);
    await settle(p, 1500); // the hand-drawn gym scene draws in
    await shot("login", p);
    await anon.close();
  }

  // ── trainer, signed in once and reused by every later context ─────────────
  context = await newContext(browser, { storageState: await sessionFor(browser, TRAINER, "trainer") });
  const page = await context.newPage();

  if (wanted("dashboard")) {
    console.log("dashboard");
    await go(page, BASE);
    await settle(page, 1500);
    await shot("dashboard", page);
    await panelShot(page, "scheduled-agents", '[data-testid="scheduled-agents"]');
  }

  if (wanted("clients")) {
    console.log("clients");
    await go(page, `${BASE}/clients`);
    await settle(page, 800);
    await shot("clients", page);
  }

  // ── one client, panel by panel ────────────────────────────────────────────
  const sarah = await clientIdByName(page, "Sarah Mitchell");
  const tom = await clientIdByName(page, "Tom Hargreaves");
  const james = await clientIdByName(page, "James Okafor");
  const priya = await clientIdByName(page, "Priya Nair");

  if (wanted("client")) {
    console.log("client detail");
    await go(page, `${BASE}/clients/${sarah}`);
    await settle(page, 2000);
    await shot("client-overview", page);
    await panelShot(page, "screening", '[data-testid="screening-summary"]');
    await panelShot(page, "injury-log", '[data-testid="injury-status-card"]');
    await panelShot(page, "body-composition", '[data-testid="log-inbody-btn"]');
    await panelShot(page, "progress-agent", '[data-testid="run-progress"]');
    await panelShot(page, "nutrition-agent", '[data-testid="run-nutrition"]');
    await panelShot(page, "messaging", '[data-testid="messaging-panel"]');
    // The per-agent source map is a collapsed disclosure — open it to shoot it.
    await page.getByTestId("agent-knowledge-toggle").click();
    await settle(page, 700);
    await panelShot(page, "agent-sources", '[data-testid="agent-knowledge-toggle"]');
    // One tall frame of the whole client record — the "everything in one place" shot.
    await tallShot(browser, "client-full", `${BASE}/clients/${sarah}`, { height: 4200 });
  }

  if (wanted("clearance")) {
    console.log("clearance gate");
    // Tom is the PAR-Q-flagged client: training blocked pending clearance.
    await go(page, `${BASE}/clients/${tom}`);
    await settle(page, 1800);
    await panelShot(page, "clearance-gate", '[data-testid="screening-summary"]');
    await panelShot(page, "first-lesson", '[data-testid="first-lesson-checklist"]');
  }

  if (wanted("programme")) {
    console.log("weekly programme");
    await go(page, `${BASE}/clients/${james}`);
    await settle(page, 1800);
    await panelShot(page, "weekly-program", '[data-testid="run-planner"]');
  }

  if (wanted("strava")) {
    console.log("strava");
    await go(page, `${BASE}/clients/${priya}`);
    await settle(page, 2200);
    await panelShot(page, "strava-activity", '[data-testid="strava-connected"], [data-testid="strava-not-connected"]');
  }

  // ── library + knowledge base ──────────────────────────────────────────────
  if (wanted("library")) {
    console.log("exercise library");
    await go(page, `${BASE}/programme?client=${tom}`);
    await settle(page, 1800);
    await shot("exercise-library", page);
    await tallShot(browser, "exercise-library-full", `${BASE}/programme?client=${tom}`, { height: 3000 });
  }

  if (wanted("knowledge")) {
    console.log("knowledge base");
    await go(page, `${BASE}/knowledge`);
    await settle(page, 1500);
    await shot("knowledge-base", page);
  }

  if (wanted("connections")) {
    console.log("connections + keys");
    await go(page, `${BASE}/connections`);
    await settle(page, 1200);
    await shot("connections", page);
    await go(page, `${BASE}/api-keys`);
    await settle(page, 1200);
    await shot("api-keys", page);
  }

  // ── public screening questionnaire ────────────────────────────────────────
  if (wanted("screening-form")) {
    console.log("screening questionnaire");
    // The dashboard's pending-invite strip carries the live token in its href;
    // the questionnaire itself is public, so it needs a signed-out context.
    await go(page, BASE);
    await settle(page, 800);
    const href = await page.locator('[data-testid^="pending-invite-"]').first().getAttribute("href").catch(() => null);
    const token = href?.match(/token=([^&]+)/)?.[1] ?? null;
    if (token) {
      const anonCtx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: "dark" });
      await anonCtx.addCookies([{ name: "app_lang", value: "en", url: BASE }]);
      const form = await anonCtx.newPage();
      await go(form, `${BASE}/onboarding/${token}`);
      await settle(form, 1500);
      await shot("screening-questionnaire", form);
      await anonCtx.close();
    } else {
      console.log("  – skipped (no pending invite on the dashboard)");
    }
  }

  // ── client portal ─────────────────────────────────────────────────────────
  if (wanted("portal")) {
    console.log("client portal");
    const { ctx: portalCtx, page: portal } = await openAs(browser, CLIENT, "client");
    await go(portal, `${BASE}/portal`);
    await settle(portal, 1800);
    await shot("portal", portal);
    await tallShot(browser, "portal-full", `${BASE}/portal`, { who: CLIENT, audience: "client", height: 3200 });
    await go(portal, `${BASE}/portal/programme`);
    await settle(portal, 1500);
    await shot("portal-programme", portal);
    // Taller frame: the grown tree plus the insight it writes underneath do not
    // fit in 900px, and the insight is the half worth reading.
    await portal.setViewportSize({ width: VIEWPORT.width, height: 1500 });
    await go(portal, `${BASE}/portal/insights`);
    await settle(portal, 1800);
    // The tree starts as four unopened branches. Growing one costs a live agent
    // call but turns a mostly-empty frame into the thing worth showing.
    await growInsight(portal, "Stamina");
    await shot("portal-insights", portal);
    await portalCtx.close();
  }

  // ── 繁中 ──────────────────────────────────────────────────────────────────
  if (wanted("chinese")) {
    console.log("繁中 UI");
    const zhCtx = await browser.newContext({
      viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: "dark",
      storageState: await sessionFor(browser, TRAINER, "trainer"),
    });
    // Overrides the app_lang=en the saved session carries.
    await zhCtx.addCookies([{ name: "app_lang", value: "zh", url: BASE }]);
    const zh = await zhCtx.newPage();
    await go(zh, BASE);
    await settle(zh, 1500);
    await shot("dashboard-zh", zh);
    await zhCtx.close();
  }

  // ── clips ─────────────────────────────────────────────────────────────────
  if (withClips && hasFfmpeg) {
    console.log("clips");

    // Pick a client in the exercise library and every card re-scores against
    // their injuries and clearance.
    if (wanted("clip-library")) {
      await clip(browser, "clip-library", {
        speed: 2, maxSeconds: 14, size: { width: 1280, height: 760 },
        run: async (p, mark) => {
          // Land already scoped to the flagged client: scoring the whole library
          // against one client takes the best part of a minute, and a clip that
          // opens on a spinner is a wasted clip. mark() goes after it settles.
          await go(p, `${BASE}/programme?client=${tom}`);
          await settle(p, 2000);
          const badge = p.locator('[data-testid="caveat-badge"]').first();
          await badge.waitFor({ timeout: 120_000 });
          await p.mouse.wheel(0, 900);
          await sleep(1500);
          await badge.scrollIntoViewIfNeeded();
          await sleep(800);
          mark();
          await badge.click();
          await sleep(3500);
          await p.mouse.wheel(0, 500);
          await sleep(2500);
          await p.mouse.wheel(0, 500);
          await sleep(2500);
        },
      });
    }

    // The Progress agent thinking out loud: live tool calls, cited sources, then
    // the written review. Sped up 3× — the real run takes the best part of a
    // minute, which is a long time to watch in a README.
    if (wanted("clip-progress")) {
      await clip(browser, "clip-progress-agent", {
        // Tight frame: the panel is the subject, not the page around it.
        speed: 5, maxSeconds: 16, size: { width: 1180, height: 640 },
        run: async (p, mark) => {
          await go(p, `${BASE}/clients/${sarah}`);
          await settle(p, 1500);
          const btn = p.getByTestId("run-progress");
          await btn.scrollIntoViewIfNeeded();
          // The panel auto-runs when the stored review isn't from today, which
          // disables the button until it finishes. Wait that out rather than
          // clicking into a disabled control.
          await p.waitForFunction(
            () => {
              const b = document.querySelector('[data-testid="run-progress"]');
              return !!b && !b.disabled;
            },
            null,
            { timeout: 180_000 },
          ).catch(() => {});
          await sleep(1200);
          mark();
          await btn.click();
          // A flag chip only renders once the finished report lands.
          await p.locator('[data-testid="progress-flag"]').first()
            .waitFor({ timeout: 180_000 }).catch(() => {});
          await sleep(3500);
        },
      });
    }

    // The client side of the same idea: tap a branch, the agent grows it from
    // that client's own data.
    if (wanted("clip-insights")) {
      await clip(browser, "clip-insight-tree", {
        speed: 3, maxSeconds: 16, size: { width: 1180, height: 820 },
        who: CLIENT, audience: "client",
        run: async (p, mark) => {
          await go(p, `${BASE}/portal/insights`);
          await settle(p, 1500);
          mark();
          await growInsight(p, "Stamina");
          await p.mouse.wheel(0, 450);
          await sleep(4000);
        },
      });
    }
  }
} finally {
  await context?.close();
  await browser.close();
  // 2× intermediates: tens of MB, and they must not survive a failed run.
  rmSync(RAW, { recursive: true, force: true });
}

console.log(`\nDone → ${path.relative(repoRoot, OUT)}/`);
for (const f of readdirSync(OUT).sort()) {
  console.log(`  ${f.padEnd(34)} ${kb(path.join(OUT, f))} KB`);
}
