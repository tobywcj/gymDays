// Loads the gitignored env files into process.env for the Playwright run.
//
// Called from playwright.config.ts, which Playwright evaluates in the main
// process AND in every worker — so specs and helpers see these values without
// anyone having to export them by hand.
//
// Precedence: a real environment variable always wins; then web/.env.local
// (what `next dev` itself reads, so specs agree with the app under test);
// then the root .env, which holds values shared with the AI service and
// scripts. Hand-rolled rather than pulling in dotenv, matching the rest of the
// repo's tooling.
import { readFileSync } from "fs";
import * as path from "path";

const webRoot = path.resolve(__dirname, "..", "..");
const repoRoot = path.resolve(webRoot, "..");

function loadFile(file: string): void {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return; // absent is fine — callers report what is actually missing
  }
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

let done = false;

export function loadEnv(): void {
  if (done) return;
  done = true;
  loadFile(path.join(webRoot, ".env.local"));
  loadFile(path.join(repoRoot, ".env"));
  // seed-test-users.mjs wants SUPABASE_URL; web/.env.local only has the public one.
  if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }
}
