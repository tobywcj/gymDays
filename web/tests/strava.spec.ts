import { test, expect, request } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { TRAINER_A, signIn } from "./helpers/auth";

// Node 20 lacks native WebSocket; supabase-js needs one to construct (even though
// we never use realtime here). Provide one before any client is built.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).WebSocket = (globalThis as any).WebSocket ?? ws;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Service-role admin client for setup/teardown that bypasses RLS.
function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

test.describe("M6 Strava ingest", () => {
  let aliceId: string;
  const ATHLETE_ID = "987654321";

  test.beforeAll(async () => {
    // Find Alice (seeded by global-setup) and stamp her with an athlete id + token.
    const db = admin();
    const { data: alice } = await db.from("clients").select("id, trainer_id")
      .eq("name", "Alice Adams").single();
    if (!alice) throw new Error("Alice Adams not found — seed must run first");
    aliceId = alice.id;

    await db.from("clients").update({ strava_athlete_id: ATHLETE_ID }).eq("id", aliceId);

    // Insert a fake token row so the webhook path that needs one finds it.
    await db.from("integration_tokens").upsert({
      trainer_id: alice.trainer_id,
      client_id: aliceId,
      provider: "strava",
      access_token: "fake-access-token",
      refresh_token: "fake-refresh-token",
      // Expires in the future so we don't trigger a refresh in the test.
      expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: "client_id,provider" });

    // Clean any prior activities for this client.
    await db.from("activities").delete().eq("client_id", aliceId);
  });

  test.afterAll(async () => {
    const db = admin();
    await db.from("activities").delete().eq("client_id", aliceId);
    await db.from("integration_tokens").delete().eq("client_id", aliceId);
    await db.from("clients").update({ strava_athlete_id: null }).eq("id", aliceId);
  });

  test("webhook verification handshake returns the challenge", async () => {
    // Read the token rather than hardcoding it — it is a real secret in any
    // deployed environment, and the route has no default to fall back on.
    const verifyToken = process.env.STRAVA_VERIFY_TOKEN;
    test.skip(!verifyToken, "STRAVA_VERIFY_TOKEN not set");
    const ctx = await request.newContext();
    const r = await ctx.get(
      "http://localhost:3478/api/strava/webhook?hub.mode=subscribe" +
        `&hub.verify_token=${encodeURIComponent(verifyToken!)}&hub.challenge=abc123`,
    );
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body["hub.challenge"]).toBe("abc123");
  });

  test("webhook verification is refused with a wrong token", async () => {
    const ctx = await request.newContext();
    const r = await ctx.get(
      "http://localhost:3478/api/strava/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123",
    );
    expect(r.status()).toBe(403);
  });

  test("webhook delete event drops the matching row", async () => {
    const db = admin();
    await db.from("activities").insert({
      trainer_id: (await db.from("clients").select("trainer_id").eq("id", aliceId).single()).data!.trainer_id,
      client_id: aliceId,
      source: "strava",
      external_id: "to-delete-1",
      started_at: new Date().toISOString(),
      type: "Run",
    });
    const ctx = await request.newContext();
    const r = await ctx.post("http://localhost:3478/api/strava/webhook", {
      data: { object_type: "activity", object_id: "to-delete-1", aspect_type: "delete", owner_id: ATHLETE_ID },
    });
    expect(r.status()).toBe(200);
    const remaining = await db.from("activities")
      .select("id").eq("client_id", aliceId).eq("external_id", "to-delete-1");
    expect(remaining.data?.length ?? 0).toBe(0);
  });

  test("dev-seed populates activities and the 3-series chart on the client detail page", async ({ page }) => {
    await signIn(page, TRAINER_A);

    // Drive the dev-seed via the API directly (the UI seed button is hidden
    // when STRAVA_CLIENT_ID is configured — connect button takes its place).
    const apiResp = await page.request.post(`/api/strava/dev-seed/${aliceId}`);
    expect(apiResp.status()).toBe(200);
    const { inserted } = await apiResp.json();
    expect(inserted).toBeGreaterThan(0);

    const { count } = await admin().from("activities")
      .select("id", { count: "exact", head: true }).eq("client_id", aliceId).eq("source", "strava-dev");
    expect(count).toBe(inserted);

    // Activities render as the distance / duration / avg-HR chart.
    await page.goto(`/clients/${aliceId}`);
    await expect(page.locator(".recharts-line")).toHaveCount(3, { timeout: 15000 });
  });

  test("Send connect link button is rendered when STRAVA_CLIENT_ID is configured", async ({ page }) => {
    const db = admin();
    // Clear any existing token on Alice so the invite button (not "connected") shows.
    await db.from("integration_tokens").delete().eq("client_id", aliceId);
    await db.from("clients").update({ strava_athlete_id: null }).eq("id", aliceId);

    await signIn(page, TRAINER_A);
    await page.goto(`/clients/${aliceId}`);
    await expect(page.getByTestId("strava-invite")).toBeVisible();
  });

  test("Disconnect removes the stored token and reveals Connect again", async ({ page }) => {
    const db = admin();
    const { data: alice } = await db.from("clients").select("trainer_id").eq("id", aliceId).single();
    // Set up: connected state.
    await db.from("clients").update({ strava_athlete_id: "12345" }).eq("id", aliceId);
    await db.from("integration_tokens").upsert({
      trainer_id: alice!.trainer_id,
      client_id: aliceId,
      provider: "strava",
      access_token: "tok-to-disconnect",
      refresh_token: "ref",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    }, { onConflict: "client_id,provider" });

    await signIn(page, TRAINER_A);
    await page.goto(`/clients/${aliceId}`);
    await expect(page.getByTestId("strava-connected")).toBeVisible();

    // Auto-confirm the window.confirm() dialog.
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("strava-disconnect").click();

    // router.refresh() triggers a server-component refetch — give it a moment.
    await expect(page.getByTestId("strava-not-connected")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("strava-invite")).toBeVisible();
    await expect(page.getByTestId("strava-disconnected-tip")).toBeVisible();

    // Token should be gone from the DB.
    const { data: stillThere } = await db.from("integration_tokens")
      .select("id").eq("client_id", aliceId).eq("provider", "strava");
    expect(stillThere?.length ?? 0).toBe(0);
  });
});
