import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { TRAINER_A, signIn } from "./helpers/auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).WebSocket = (globalThis as any).WebSocket ?? ws;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

test.describe("Scheduled agents (auto-messaging)", () => {
  test("trainer can create, see, and delete a scheduled agent", async ({ page }) => {
    const db = admin();
    const name = `e2e reminder ${Date.now()}`;

    await signIn(page, TRAINER_A);
    await expect(page.getByTestId("scheduled-agents")).toBeVisible();

    // Open the create form and fill it in (all active clients, daily).
    await page.getByTestId("agents-new").click();
    await page.getByTestId("agent-name").fill(name);
    await page.getByTestId("agent-flow-weekly-checkin").click();
    await page.getByTestId("agent-time").fill("09:30");
    await page.getByTestId("agent-submit").click();

    // It should appear as a row.
    const row = page.getByTestId("agent-schedule-row").filter({ hasText: name });
    await expect(row).toBeVisible();

    // It was persisted for the trainer.
    const { data } = await db.from("scheduled_agents").select("id, flow, target_all").eq("name", name).single();
    expect(data?.flow).toBe("weekly-checkin");
    expect(data?.target_all).toBe(true);

    // Delete via the UI (auto-accept the confirm dialog).
    page.on("dialog", (d) => d.accept());
    await row.getByTestId("agent-delete").click();
    await expect(row).toHaveCount(0);

    // Cleanup any stragglers.
    await db.from("scheduled_agents").delete().eq("name", name);
  });
});
