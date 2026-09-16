// Runs once before the test suite. Re-seeds the test trainers + clients so
// every run starts from a known state.
import { execSync } from "child_process";
import { readFileSync } from "fs";
import * as path from "path";

const webRoot = path.resolve(__dirname, "..");

function loadDotenvLocal() {
  try {
    const text = readFileSync(path.join(webRoot, ".env.local"), "utf8");
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
  } catch {
    // .env.local missing — caller will get a clear error from the seed script
  }
}

async function globalSetup() {
  loadDotenvLocal();
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("[global-setup] SUPABASE_SERVICE_ROLE_KEY not set — skipping seed");
    return;
  }
  if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }
  console.log("[global-setup] reseeding test trainers + clients…");
  execSync("node scripts/seed-test-users.mjs", {
    cwd: webRoot,
    stdio: "inherit",
    env: process.env,
  });
}

export default globalSetup;
