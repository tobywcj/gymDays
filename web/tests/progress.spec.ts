import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { TRAINER_A, signIn } from "./helpers/auth";

(globalThis as any).WebSocket = (globalThis as any).WebSocket ?? ws; // eslint-disable-line @typescript-eslint/no-explicit-any

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

test.describe("M9 Progress flags surface on the dashboard", () => {
  let aliceId: string;
  let aliceTrainerId: string;

  test.beforeAll(async () => {
    const db = admin();
    const { data: alice } = await db.from("clients").select("id, trainer_id")
      .eq("name", "Alice Adams").single();
    if (!alice) throw new Error("Alice Adams not found — seed must run first");
    aliceId = alice.id;
    aliceTrainerId = alice.trainer_id;

    // Set Alice to Flagged + write a progress report with an overtraining flag.
    await db.from("clients").update({ status: "Flagged" }).eq("id", aliceId);
    await db.from("progress_reports").delete().eq("client_id", aliceId);
    await db.from("progress_reports").insert({
      trainer_id:   aliceTrainerId,
      client_id:    aliceId,
      period_start: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      period_end:   new Date().toISOString().slice(0, 10),
      summary:      "Volume escalated +120% over 4 weeks while HRV fell 37%.",
      flags: [{
        kind: "overtraining",
        severity: "high",
        rationale: "Volume +120%, HRV -37% over 4 weeks.",
        raised_at: new Date().toISOString(),
      }],
    });
  });

  test.afterAll(async () => {
    const db = admin();
    await db.from("clients").update({ status: "Active" }).eq("id", aliceId);
    await db.from("progress_reports").delete().eq("client_id", aliceId);
  });

  test("flagged client renders Flagged badge on the clients table", async ({ page }) => {
    await signIn(page, TRAINER_A);
    await page.goto("/clients");
    // Alice's row should now have the Flagged badge (red dot).
    const aliceRow = page.getByTestId("client-row").filter({ hasText: "Alice Adams" });
    await expect(aliceRow).toBeVisible();
    await expect(aliceRow).toContainText(/Flagged/i);
  });

  test("client detail shows the progress report + flag", async ({ page }) => {
    await signIn(page, TRAINER_A);
    await page.goto(`/clients/${aliceId}`);
    await expect(page.locator("text=Progress Review")).toBeVisible();
    const flagRow = page.getByTestId("progress-flag");
    await expect(flagRow).toBeVisible();
    await expect(flagRow).toContainText(/overtraining/i);
    await expect(flagRow).toContainText(/high/i);
  });
});
