import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { TRAINER_A, signIn } from "./helpers/auth";
import { computeNextRun } from "../lib/schedule";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).WebSocket = (globalThis as any).WebSocket ?? ws;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

// ─── computeNextRun (pure) ──────────────────────────────────────────────────
test.describe("Scheduled agents — computeNextRun", () => {
  const from = new Date("2026-09-16T08:30:00Z"); // a Wednesday

  test("daily later today fires today", () => {
    const next = computeNextRun({ frequency: "daily", hour: 9, minute: 0, weekday: null, tzOffsetMinutes: 0 }, from);
    expect(next.toISOString()).toBe("2026-09-16T09:00:00.000Z");
  });

  test("daily already passed rolls to tomorrow (strictly after `from`)", () => {
    const next = computeNextRun({ frequency: "daily", hour: 8, minute: 30, weekday: null, tzOffsetMinutes: 0 }, from);
    expect(next.toISOString()).toBe("2026-09-17T08:30:00.000Z");
  });

  test("weekly skips to the requested weekday", () => {
    const next = computeNextRun({ frequency: "weekly", hour: 9, minute: 0, weekday: 1, tzOffsetMinutes: 0 }, from);
    expect(next.toISOString()).toBe("2026-09-21T09:00:00.000Z"); // next Monday
  });

  test("local wall-clock converts via tz offset (HKT = -480)", () => {
    // 09:00 in UTC+8 is 01:00 UTC — already passed at 08:30 UTC, so tomorrow.
    const next = computeNextRun({ frequency: "daily", hour: 9, minute: 0, weekday: null, tzOffsetMinutes: -480 }, from);
    expect(next.toISOString()).toBe("2026-09-17T01:00:00.000Z");
  });

  test("weekly local weekday uses local date, not UTC date", () => {
    // 2026-09-16T20:00Z is already Thursday 04:00 in UTC+8.
    const lateUtc = new Date("2026-09-16T20:00:00Z");
    const next = computeNextRun({ frequency: "weekly", hour: 7, minute: 0, weekday: 4, tzOffsetMinutes: -480 }, lateUtc);
    expect(next.toISOString()).toBe("2026-09-16T23:00:00.000Z"); // Thu 07:00 HKT
  });
});

// ─── Scheduled agents API ───────────────────────────────────────────────────
test.describe("Scheduled agents — API", () => {
  const created: string[] = [];

  test.afterAll(async () => {
    if (created.length) await admin().from("scheduled_agents").delete().in("id", created);
  });

  test("dispatch rejects calls without the cron secret", async ({ request }) => {
    const r = await request.post("/api/agents/scheduled/dispatch", { headers: { "x-cron-secret": "wrong" } });
    expect(r.status()).toBe(403);
  });

  test("unauthenticated list is rejected", async ({ request }) => {
    const r = await request.get("/api/agents/scheduled");
    expect(r.status()).toBe(401);
  });

  test("trainer creates, lists and deletes a schedule; validation guards hold", async ({ page }) => {
    await signIn(page, TRAINER_A);
    const db = admin();
    const { data: ownClient } = await db.from("clients").select("id").eq("name", "Aaron Avery").single();
    const { data: otherClient } = await db.from("clients").select("id").eq("name", "Bea Bates").single();
    // ~12h out so the live 5-minute dispatch cron can't fire it before teardown.
    const hour = (new Date().getUTCHours() + 12) % 24;
    const base = { name: "phase3 test", flow: "weekly-checkin", frequency: "daily", hour, minute: 0, tz_offset_minutes: 0 };

    const bad = async (body: object, error: string) => {
      const r = await page.request.post("/api/agents/scheduled", { data: body });
      expect(r.status(), JSON.stringify(body)).toBe(422);
      expect((await r.json()).error).toBe(error);
    };
    await bad({ ...base, client_ids: [ownClient!.id], flow: "rm-rf" }, "invalid flow");
    await bad({ ...base, client_ids: [ownClient!.id], frequency: "weekly" }, "weekday required for weekly");
    await bad({ ...base, client_ids: [ownClient!.id], hour: 24 }, "invalid hour");
    await bad({ ...base, client_ids: [] }, "select at least one client");
    await bad({ ...base, client_ids: [otherClient!.id] }, "unknown client"); // trainer B's client

    const r = await page.request.post("/api/agents/scheduled", { data: { ...base, client_ids: [ownClient!.id] } });
    expect(r.ok()).toBeTruthy();
    const { schedule } = await r.json();
    created.push(schedule.id);
    expect(new Date(schedule.next_run_at).getTime()).toBeGreaterThan(Date.now());

    const list = await (await page.request.get("/api/agents/scheduled")).json();
    expect(list.schedules.map((s: { id: string }) => s.id)).toContain(schedule.id);

    const del = await page.request.delete(`/api/agents/scheduled/${schedule.id}`);
    expect(del.ok()).toBeTruthy();
    const { data: gone } = await db.from("scheduled_agents").select("id").eq("id", schedule.id);
    expect(gone).toHaveLength(0);
  });
});

// ─── Portal program-change request ──────────────────────────────────────────
test.describe("Portal — program-change request", () => {
  test("rejects anonymous callers", async ({ request }) => {
    const r = await request.post("/api/portal/program-request", { data: { body: "more cardio" } });
    expect(r.status()).toBe(401);
  });

  test("rejects trainers (client-only write path)", async ({ page }) => {
    await signIn(page, TRAINER_A);
    const r = await page.request.post("/api/portal/program-request", { data: { body: "more cardio" } });
    expect(r.status()).toBe(401);
  });
});

// ─── Strava webhook hardening ───────────────────────────────────────────────
test.describe("Strava webhook — token failures + deauthorization", () => {
  let clientId: string;
  let trainerId: string;
  const ATHLETE_ID = `phase3-${Date.now()}`;

  test.beforeAll(async () => {
    const db = admin();
    const { data: c } = await db.from("clients").select("id, trainer_id").eq("name", "Aaron Avery").single();
    clientId = c!.id;
    trainerId = c!.trainer_id;
    await db.from("clients").update({ strava_athlete_id: ATHLETE_ID }).eq("id", clientId);
  });

  test.afterAll(async () => {
    const db = admin();
    await db.from("integration_tokens").delete().eq("client_id", clientId).eq("provider", "strava");
    await db.from("clients").update({ strava_athlete_id: null }).eq("id", clientId);
  });

  async function stampToken(expiresInMs: number) {
    await admin().from("integration_tokens").upsert({
      trainer_id: trainerId,
      client_id: clientId,
      provider: "strava",
      access_token: "fake-access",
      refresh_token: "fake-refresh-that-strava-rejects",
      expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    }, { onConflict: "client_id,provider" });
  }

  test("dead refresh token answers 200 'skipped' instead of a 500 Strava would replay", async ({ request }) => {
    await stampToken(-60_000); // expired → forces a refresh, which Strava rejects
    const r = await request.post("/api/strava/webhook", {
      data: { object_type: "activity", aspect_type: "create", object_id: 1, owner_id: ATHLETE_ID },
    });
    expect(r.status()).toBe(200);
    expect(await r.json()).toMatchObject({ status: "skipped", reason: "reconnect_required" });
  });

  test("athlete deauthorization clears the client's Strava link", async ({ request }) => {
    await stampToken(6 * 3600_000);
    const r = await request.post("/api/strava/webhook", {
      data: { object_type: "athlete", aspect_type: "update", object_id: 1, owner_id: ATHLETE_ID,
              updates: { authorized: "false" } },
    });
    expect(r.status()).toBe(200);
    expect(await r.json()).toMatchObject({ status: "deauthorized", clients: 1 });

    const db = admin();
    const { data: tokens } = await db.from("integration_tokens").select("id")
      .eq("client_id", clientId).eq("provider", "strava");
    expect(tokens).toHaveLength(0);
    const { data: client } = await db.from("clients").select("strava_athlete_id").eq("id", clientId).single();
    expect(client!.strava_athlete_id).toBeNull();
  });

  test("other athlete updates are ignored", async ({ request }) => {
    const r = await request.post("/api/strava/webhook", {
      data: { object_type: "athlete", aspect_type: "update", object_id: 1, owner_id: ATHLETE_ID,
              updates: { title: "renamed" } },
    });
    expect(await r.json()).toMatchObject({ status: "ignored" });
  });
});
