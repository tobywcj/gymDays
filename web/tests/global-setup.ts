// Runs once before the test suite. Re-seeds the test trainers + clients so
// every run starts from a known state.
import { execSync } from "child_process";
import * as path from "path";
import { loadEnv } from "./helpers/load-env";

const webRoot = path.resolve(__dirname, "..");

async function globalSetup() {
  loadEnv();
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("[global-setup] SUPABASE_SERVICE_ROLE_KEY not set — skipping seed");
    return;
  }
  console.log("[global-setup] reseeding test trainers + clients…");
  execSync("node scripts/seed-test-users.mjs", {
    cwd: webRoot,
    stdio: "inherit",
    env: process.env,
  });
}

export default globalSetup;
