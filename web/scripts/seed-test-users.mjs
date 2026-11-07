// Seed two test trainers (each with their own clients) for M3 tests.
// Idempotent: re-running deletes + recreates.
//
//   source env.sh && set -a && source .env && set +a
//   node web/scripts/seed-test-users.mjs

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import ws from "ws";
// Node 20 lacks native WebSocket; provide one for realtime-js init (we don't actually use realtime here).
globalThis.WebSocket = globalThis.WebSocket ?? ws;

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Fixture passwords are generated per run, never committed. These accounts are
// created in whichever Supabase project the env vars point at — a literal here
// would be a working password for anyone reading the repo. Set
// SEED_TEST_PASSWORD to pin one for a test suite that needs a stable login.
function testPassword() {
  return process.env.SEED_TEST_PASSWORD ?? `Seed!${randomBytes(12).toString("base64url")}`;
}

const fixtures = [
  {
    email: "trainer-a@test.gymdays.local",
    password: testPassword(),
    full_name: "Trainer A",
    clients: [
      { name: "Alice Adams", goal: "Fat Loss",     status: "Active",  strava: true  },
      { name: "Aaron Avery", goal: "Hypertrophy",  status: "Active",  strava: false },
    ],
  },
  {
    email: "trainer-b@test.gymdays.local",
    password: testPassword(),
    full_name: "Trainer B",
    clients: [
      { name: "Bella Briggs", goal: "Marathon",        status: "Resting", strava: true  },
      { name: "Ben Burton",   goal: "General Fitness", status: "Flagged", strava: false },
      { name: "Bea Bates",    goal: "Strength",        status: "Active",  strava: true  },
    ],
  },
];

async function findUserByEmail(email) {
  // paginate just in case; for our test fixtures one page is plenty
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

for (const t of fixtures) {
  // Clean up any prior trainers row with this email (auth user has no FK to
  // trainers, so leftover trainers rows would collide on the unique email
  // when the trigger re-fires on user creation).
  await supabase.from("trainers").delete().eq("email", t.email);

  const existing = await findUserByEmail(t.email);
  if (existing) {
    await supabase.auth.admin.deleteUser(existing.id);
    console.log(`× removed prior ${t.email}`);
  }

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: t.email,
    password: t.password,
    email_confirm: true,
    user_metadata: { full_name: t.full_name },
  });
  if (createErr) throw createErr;
  const userId = created.user.id;
  console.log(`+ created ${t.email}  (auth.users.id = ${userId})`);

  // Trigger should have inserted public.trainers; upsert just in case.
  const { error: upsertErr } = await supabase
    .from("trainers")
    .upsert({ id: userId, email: t.email, full_name: t.full_name }, { onConflict: "id" });
  if (upsertErr) throw upsertErr;

  const rows = t.clients.map((c) => ({
    trainer_id: userId,
    name: c.name,
    goal: c.goal,
    status: c.status,
    strava_athlete_id: c.strava ? `seed-${userId.slice(0, 8)}-${c.name.replace(/\s/g, "")}` : null,
  }));
  const { error: clientsErr } = await supabase.from("clients").insert(rows);
  if (clientsErr) throw clientsErr;
  console.log(`  + ${rows.length} clients for ${t.email}`);
}

console.log("\nDone. Test credentials:");
for (const t of fixtures) {
  console.log(`  ${t.email}  /  ${t.password}`);
}
