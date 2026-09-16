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

test.describe("Connections page (Telegram + Email)", () => {
  test.beforeAll(async () => {
    // Clean any prior creds for trainer-a.
    const db = admin();
    const { data: trainer } = await db.from("trainers").select("id").eq("email", TRAINER_A.email).single();
    if (trainer) {
      await db.from("messaging_credentials").delete().eq("trainer_id", trainer.id);
    }
  });

  test("page renders the Telegram + Email provider cards and a sidebar link", async ({ page }) => {
    await signIn(page, TRAINER_A);
    await page.goto("/connections");
    // Page header + sidebar link both say "Connections" — pin to the description.
    await expect(page.locator("text=Bring your own messaging credentials")).toBeVisible();
    // First card gets a generous timeout — the ConnectionsPanel is a client
    // component whose data fetch can lag on a cold dev-server compile.
    await expect(page.getByTestId("connection-telegram")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("connection-email")).toBeVisible();
    // WhatsApp providers are gone.
    await expect(page.getByTestId("connection-twilio-whatsapp")).toHaveCount(0);
    await expect(page.getByTestId("connection-meta-whatsapp")).toHaveCount(0);
    // Telegram card has a Connect button.
    await expect(page.getByTestId("toggle-telegram")).toBeVisible();
    // Sidebar quick link.
    await page.goto("/");
    await expect(page.getByTestId("nav-connections")).toBeVisible();
  });

  test("saving Telegram bot token via the UI persists to DB (skipping live test)", async ({ page }) => {
    await signIn(page, TRAINER_A);
    const resp = await page.request.post("/api/connections/telegram", {
      data: { credentials: { bot_token: "123456:ABC-DEF-test-token" }, skip_test: true },
    });
    expect(resp.status()).toBe(200);

    const db = admin();
    const { data: trainer } = await db.from("trainers").select("id").eq("email", TRAINER_A.email).single();
    const { data: rows } = await db.from("messaging_credentials")
      .select("provider, credentials, status")
      .eq("trainer_id", trainer!.id);
    const tg = rows!.find((r) => r.provider === "telegram");
    expect(tg).toBeTruthy();
    expect((tg!.credentials as Record<string, string>).bot_token).toBe("123456:ABC-DEF-test-token");
    expect(tg!.status).toBe("connected");

    // Reload page → card shows "Connected" + redacted token.
    await page.goto("/connections");
    const card = page.getByTestId("connection-telegram");
    await expect(card).toContainText("Connected", { timeout: 10000 });
    await expect(card).toContainText("…oken");
  });

  test("disconnect removes the credentials", async ({ page }) => {
    await signIn(page, TRAINER_A);
    const resp = await page.request.delete("/api/connections/telegram");
    expect(resp.status()).toBe(200);

    const db = admin();
    const { data: trainer } = await db.from("trainers").select("id").eq("email", TRAINER_A.email).single();
    const { data: rows } = await db.from("messaging_credentials")
      .select("provider")
      .eq("trainer_id", trainer!.id)
      .eq("provider", "telegram");
    expect(rows!.length).toBe(0);
  });
});
