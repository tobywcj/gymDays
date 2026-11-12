// Seed the SHOWCASE trainer — the account the README screenshots and clips are
// captured from (scripts/capture-showcase.mjs drives it).
//
// This is deliberately separate from seed-test-users.mjs: that one keeps two
// deliberately thin trainers so the Playwright assertions stay stable, while
// this one fills every panel the UI has (activities, programmes, sessions with
// feedback, InBody history, screenings, injuries, change requests, knowledge
// base, scheduled agents) so a capture shows the product with data in it rather
// than a grid of empty states.
//
// Everything is fictional. Names, metrics and notes are invented for the demo —
// no real client data is ever used for a public asset.
//
//   source env.sh && set -a && source .env && set +a
//   npm run seed:demo        (from the repo root)
//
// Idempotent: deletes the demo trainer and rebuilds from scratch, so a capture
// run always starts from the same roster. Dates are anchored to *today*, so the
// dashboard metrics and the calendar are current whenever it runs.

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import ws from "ws";
// Node 20 lacks native WebSocket; realtime-js wants one at client construction.
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

export const DEMO_TRAINER_EMAIL = "coach@demo.gymdays.local";
const DEMO_TRAINER_NAME = "Coach Jordan Wu";

// Same rule as seed-test-users.mjs: never a literal in the repo. These accounts
// are created in whichever Supabase project the env points at, so a committed
// password would be a working login for anyone reading the source.
// SEED_DEMO_PASSWORD pins it for the capture script; SEED_TEST_PASSWORD is
// accepted as a fallback so a single value can drive both seeds.
const password =
  process.env.SEED_DEMO_PASSWORD ??
  process.env.SEED_TEST_PASSWORD ??
  `Demo!${randomBytes(12).toString("base64url")}`;
const pinnedPassword = !!(process.env.SEED_DEMO_PASSWORD || process.env.SEED_TEST_PASSWORD);

// ─── date helpers (everything anchored to today) ────────────────────────────
// Dates are built in LOCAL time, not UTC. The UI compares against the viewer's
// local day ("is this review from today?", "which calendar cell?"), so a UTC
// date string lands on the wrong day for anyone east or west of Greenwich —
// which showed up as a seeded same-day progress review being treated as stale.
const DAY = 86_400_000;
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const dayStr = (offsetDays) => {
  const d = new Date(now + offsetDays * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** Monday of the current week, as YYYY-MM-DD. */
function mondayOfThisWeek() {
  const dow = new Date(now).getDay(); // 0=Sun
  return dayStr(-((dow + 6) % 7));
}
/** An ISO timestamp at a given LOCAL hour on a day `offsetDays` from today. */
const at = (offsetDays, hour, minute = 0) => {
  const d = new Date(now + offsetDays * DAY);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const round = (n, dp = 1) => Number(n.toFixed(dp));

// ─── roster ─────────────────────────────────────────────────────────────────
// Each client is shaped to light up a different part of the UI, so one capture
// run covers every panel: a Strava endurance athlete, a hypertrophy lifter, a
// fat-loss client with a pending request, a flagged client awaiting medical
// clearance, a resting client (drives the "quiet" metric) and a 繁中 client.
const CLIENTS = [
  {
    key: "priya",
    name: "Priya Nair",
    email: "priya@demo.gymdays.local",
    goal: "Marathon sub-3:30",
    status: "Active",
    aft_level: "yellow",
    aft_rationale:
      "Consistent 45–60 km weeks with controlled HR drift and clean hinge mechanics — comfortably in the recreational-athlete band. Holds off orange until max-strength work is in the plan.",
    language: "en",
    strava: true,
    telegram: true,
    phone: "+852 5100 2201",
  },
  {
    key: "james",
    name: "James Okafor",
    email: "james@demo.gymdays.local",
    goal: "Hypertrophy — upper-body mass",
    status: "Active",
    aft_level: "orange",
    aft_rationale:
      "Trains four days a week at advanced complexity: pull-ups weighted, front squats loaded, suspension work in rotation. Max-strength numbers put him in the trained-athlete band.",
    language: "en",
    strava: false,
    telegram: true,
    phone: "+852 5100 2202",
  },
  {
    key: "sarah",
    name: "Sarah Mitchell",
    email: "sarah@demo.gymdays.local",
    goal: "Fat loss — 8 kg in 16 weeks",
    status: "Active",
    aft_level: "green",
    aft_rationale:
      "Twelve weeks in, movement screens clean and aerobic base building steadily. Prepared-individual band: general aerobic plus basic resistance, no advanced loading yet.",
    language: "en",
    strava: true,
    telegram: true,
    phone: "+852 5100 2203",
  },
  {
    key: "tom",
    name: "Tom Hargreaves",
    email: "tom@demo.gymdays.local",
    goal: "Return to lifting after lower-back flare",
    status: "Flagged",
    aft_level: "blue",
    aft_rationale:
      "Active lower-back episode with a PAR-Q flag outstanding. Corrective, stable, low-load work only until written clearance lands.",
    language: "en",
    strava: true,
    telegram: false,
    phone: "+852 5100 2204",
  },
  {
    key: "ella",
    name: "Ella Fontaine",
    email: "ella@demo.gymdays.local",
    goal: "General fitness",
    status: "Resting",
    aft_level: "green",
    language: "en",
    strava: true,
    telegram: false,
    phone: "+852 5100 2205",
  },
  {
    key: "kaming",
    name: "Wong Ka Ming",
    email: "kaming@demo.gymdays.local",
    goal: "Strength — first bodyweight pull-up",
    status: "Active",
    aft_level: "green",
    language: "zh",
    strava: false,
    telegram: true,
    phone: "+852 5100 2206",
  },
];

// ─── 0. reset ───────────────────────────────────────────────────────────────
async function findUserByEmail(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function reset() {
  // trainers has no FK from auth.users, so a leftover row would collide on the
  // unique email when the new-user trigger re-fires.
  await supabase.from("trainers").delete().eq("email", DEMO_TRAINER_EMAIL);
  const existing = await findUserByEmail(DEMO_TRAINER_EMAIL);
  if (existing) {
    await supabase.auth.admin.deleteUser(existing.id);
    console.log(`× removed prior ${DEMO_TRAINER_EMAIL}`);
  }
  // The demo clients get portal logins of their own; drop those auth users too
  // so re-running doesn't leave orphans pointing at deleted client rows.
  for (const c of CLIENTS) {
    const u = await findUserByEmail(c.email);
    if (u) await supabase.auth.admin.deleteUser(u.id);
  }
}

// ─── 1. trainer ─────────────────────────────────────────────────────────────
async function createTrainer() {
  const { data: created, error } = await supabase.auth.admin.createUser({
    email: DEMO_TRAINER_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { full_name: DEMO_TRAINER_NAME },
  });
  if (error) throw error;
  const id = created.user.id;
  const { error: upErr } = await supabase
    .from("trainers")
    .upsert({ id, email: DEMO_TRAINER_EMAIL, full_name: DEMO_TRAINER_NAME }, { onConflict: "id" });
  if (upErr) throw upErr;
  console.log(`+ trainer ${DEMO_TRAINER_EMAIL}`);
  return id;
}

// ─── 2. clients ─────────────────────────────────────────────────────────────
async function createClients(trainerId) {
  const rows = CLIENTS.map((c) => ({
    trainer_id: trainerId,
    name: c.name,
    email: c.email,
    phone: c.phone,
    goal: c.goal,
    status: c.status,
    language: c.language,
    aft_level: c.aft_level ?? null,
    aft_rationale: c.aft_rationale ?? null,
    aft_classified_at: c.aft_level ? iso(2 * DAY) : null,
    strava_athlete_id: c.strava ? `demo-${c.key}-athlete` : null,
    telegram_chat_id: c.telegram ? `demo-${c.key}-chat` : null,
    preferred_channel: c.telegram ? "telegram" : null,
    equipment: ["barbell", "dumbbell", "cable", "bodyweight"],
    schedule: { days: ["Mon", "Wed", "Fri"], slot: "07:00" },
  }));
  const { data, error } = await supabase.from("clients").insert(rows).select("id, name");
  if (error) throw error;
  const byKey = {};
  CLIENTS.forEach((c, i) => { byKey[c.key] = data[i].id; });
  console.log(`+ ${data.length} clients`);
  return byKey;
}

// Give each demo client a portal login so the client-portal captures can sign
// in as them. The 0025 trigger links a new auth user to any client row whose
// email matches, so creating the user is enough — no manual auth_user_id write.
async function createClientLogins() {
  for (const c of CLIENTS) {
    const { error } = await supabase.auth.admin.createUser({
      email: c.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: c.name },
    });
    if (error) throw error;
  }
  console.log(`+ ${CLIENTS.length} client portal logins`);
}

// ─── 3. exercise lookup ─────────────────────────────────────────────────────
async function exerciseIds() {
  const { data, error } = await supabase.from("exercise_db").select("id, name");
  if (error) throw error;
  const byName = new Map(data.map((e) => [e.name, e.id]));
  return (name) => {
    const id = byName.get(name);
    if (!id) throw new Error(`exercise_db has no "${name}" — re-run migrations 0004/0028`);
    return id;
  };
}

// ─── 4. Strava activities ───────────────────────────────────────────────────
// Twelve weeks of plausible endurance work. A flat ramp renders as a flat chart,
// so the block has the shape a real one has: a three-week build, a deload every
// fourth week, session counts that move with it, and per-session jitter. The
// current (part-elapsed) week is generated up to today only.

/** Deterministic jitter in [-1, 1] — same seed, same chart, every run. */
function wobble(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** A week's session plan: the deload weeks drop a session and the volume. */
function weekPlan(weeksAgo, profile) {
  const deload = weeksAgo % 4 === 3;
  const km = profile.kmPerWeek(weeksAgo) * (deload ? 0.65 : 1);
  if (km <= 0) return { km: 0, sessions: [] };
  const sessions = deload
    ? [
        { day: 2, share: 0.35, name: "Easy recovery run", hr: -14 },
        { day: 5, share: 0.65, name: "Steady run", hr: -2 },
      ]
    : [
        { day: 1, share: 0.18, name: "Easy shakeout", hr: -12 },
        { day: 3, share: 0.30, name: "Tempo intervals", hr: +14 },
        { day: 6, share: 0.52, name: "Long run", hr: +2 },
      ];
  // Peak weeks pick up a fourth easy session.
  if (!deload && weeksAgo % 4 === 2) sessions.splice(2, 0, { day: 4, share: 0.16, name: "Easy double", hr: -10 });
  return { km, sessions, deload };
}

/** Days since the Monday of the current week (0 = it is Monday today). */
const daysSinceMonday = (new Date(now).getDay() + 6) % 7;

function runWeek(trainerId, clientId, weeksAgo, profile, key) {
  const { km: weekKm, sessions } = weekPlan(weeksAgo, profile);
  const out = [];
  const totalShare = sessions.reduce((s, p) => s + p.share, 0) || 1;
  for (const p of sessions) {
    // `day` is 1=Mon … 7=Sun within that week, anchored to real Mondays so the
    // chart's weekly buckets line up. A negative offset is in the future, which
    // is how the current week ends up part-done instead of dropping to zero.
    const off = daysSinceMonday + weeksAgo * 7 - (p.day - 1);
    if (off < 0) continue;
    const jitter = 1 + wobble(off + clientId.charCodeAt(0)) * 0.12;
    const km = round((weekKm * (p.share / totalShare)) * jitter, 1);
    if (km <= 0) continue;
    const paceSecPerKm = Math.round(profile.pace + (p.hr > 10 ? -24 : p.hr < -10 ? 28 : 0) + wobble(off) * 8);
    const duration = Math.round(km * paceSecPerKm);
    const avgHr = Math.round(profile.restHr + 70 + p.hr + (12 - weeksAgo) * 0.4 + wobble(off * 3) * 3);
    out.push({
      trainer_id: trainerId,
      client_id: clientId,
      source: "strava",
      external_id: `demo-${key}-${off}`,
      started_at: at(-off, 6, 40),
      type: "Run",
      distance_m: Math.round(km * 1000),
      duration_s: duration,
      metrics: {
        name: p.name,
        average_heartrate: avgHr,
        max_heartrate: avgHr + 16,
        average_speed: round(1000 / paceSecPerKm, 3),
        max_speed: round(1000 / (paceSecPerKm - 35), 3),
        total_elevation_gain: Math.round(km * profile.elevPerKm),
        suffer_score: Math.round((duration / 60) * (p.hr > 10 ? 1.5 : 0.75)),
        calories: Math.round(km * 68),
        hr_zones: profile.zones(p.hr),
      },
    });
  }
  return out;
}

// Zone splits are polarised on purpose — most of the work easy, a clear hard
// session — which is what a coached endurance block should look like.
const PROFILES = {
  priya: {
    pace: 288, restHr: 52, elevPerKm: 9,
    kmPerWeek: (w) => 58 - w * 1.9,
    zones: (hr) => (hr > 10
      ? { z1: 600, z2: 960, z3: 900, z4: 1500, z5: 480 }
      : { z1: 1500, z2: 3300, z3: 540, z4: 90, z5: 0 }),
  },
  sarah: {
    pace: 372, restHr: 64, elevPerKm: 5,
    kmPerWeek: (w) => 26 - w * 1.1,
    zones: (hr) => (hr > 10
      ? { z1: 420, z2: 900, z3: 1080, z4: 720, z5: 120 }
      : { z1: 1080, z2: 1920, z3: 360, z4: 60, z5: 0 }),
  },
  // Deliberately stale: nothing in the last fortnight, so Tom and Ella land in
  // the dashboard's "quiet clients" card.
  tom: {
    pace: 420, restHr: 70, elevPerKm: 3,
    kmPerWeek: (w) => (w < 2 ? 0 : 14 - w * 0.6),
    zones: () => ({ z1: 1200, z2: 1080, z3: 180, z4: 0, z5: 0 }),
  },
  ella: {
    pace: 400, restHr: 68, elevPerKm: 4,
    kmPerWeek: (w) => (w < 3 ? 0 : 18 - w * 0.8),
    zones: () => ({ z1: 1020, z2: 1440, z3: 300, z4: 0, z5: 0 }),
  },
};

async function seedActivities(trainerId, ids) {
  const rows = [];
  for (const [key, profile] of Object.entries(PROFILES)) {
    for (let w = 0; w < 12; w++) {
      rows.push(...runWeek(trainerId, ids[key], w, profile, key));
    }
  }
  const { error } = await supabase.from("activities").insert(rows);
  if (error) throw error;

  // Placeholder OAuth rows so the Strava panel renders its *connected* state
  // (sync, HR backfill, disconnect) rather than the connect prompt. The tokens
  // are obviously fake — a real sync against them fails, which is the right
  // outcome for a demo account that must not touch anyone's Strava data.
  const tokens = Object.keys(PROFILES).map((key) => ({
    trainer_id: trainerId, client_id: ids[key], provider: "strava",
    access_token: `demo-not-a-real-token-${key}`,
    refresh_token: `demo-not-a-real-refresh-${key}`,
    expires_at: iso(-30 * DAY),
  }));
  const { error: tErr } = await supabase.from("integration_tokens").insert(tokens);
  if (tErr) throw tErr;
  console.log(`+ ${rows.length} activities, ${tokens.length} Strava connections`);
}

// ─── 5. InBody / BIA history ────────────────────────────────────────────────
function bodyComp(trainerId, clientId, points) {
  return points.map((p, i) => ({
    trainer_id: trainerId,
    client_id: clientId,
    recorded_at: iso(p.daysAgo * DAY),
    source: i === points.length - 1 ? "intake" : "session",
    weight_kg: p.weight,
    bmi: round(p.weight / (p.heightM * p.heightM), 1),
    body_fat_pct: p.bf,
    fat_free_mass_kg: round(p.weight * (1 - p.bf / 100), 1),
    bmr_kcal: Math.round(370 + 21.6 * p.weight * (1 - p.bf / 100)),
    waist_hip_ratio: p.whr,
    total_body_water_pct: round((1 - p.bf / 100) * 72, 1),
    notes: p.notes ?? null,
    extra_metrics: {
      _machine: "InBody 570",
      skeletal_muscle_mass_kg: { label: "Skeletal Muscle Mass", value: round(p.weight * (1 - p.bf / 100) * 0.54, 1), unit: "kg" },
      visceral_fat_level: { label: "Visceral Fat Level", value: p.visceral, unit: "" },
      inbody_score: { label: "InBody Score", value: p.score, unit: "" },
      protein_kg: { label: "Protein", value: round(p.weight * (1 - p.bf / 100) * 0.2, 1), unit: "kg" },
      minerals_kg: { label: "Minerals", value: round(p.weight * 0.042, 2), unit: "kg" },
    },
  }));
}

async function seedBodyComp(trainerId, ids) {
  const rows = [
    // Fat loss: weight and body fat trending down, lean mass held.
    ...bodyComp(trainerId, ids.sarah, [
      { daysAgo: 3,  weight: 71.4, bf: 28.6, whr: 0.79, visceral: 7,  score: 76, heightM: 1.66, notes: "Down 1.1 kg on the month, lean mass flat — exactly the split we wanted." },
      { daysAgo: 31, weight: 72.5, bf: 30.1, whr: 0.81, visceral: 8,  score: 73, heightM: 1.66 },
      { daysAgo: 59, weight: 74.2, bf: 31.8, whr: 0.82, visceral: 9,  score: 70, heightM: 1.66 },
      { daysAgo: 87, weight: 76.0, bf: 33.4, whr: 0.84, visceral: 10, score: 67, heightM: 1.66, notes: "Intake reading." },
    ]),
    // Hypertrophy: weight up, body fat roughly flat → lean mass gain.
    ...bodyComp(trainerId, ids.james, [
      { daysAgo: 5,  weight: 84.6, bf: 15.2, whr: 0.86, visceral: 6, score: 88, heightM: 1.81, notes: "+2.4 kg lean since intake at the same body-fat percentage." },
      { daysAgo: 33, weight: 83.1, bf: 15.4, whr: 0.86, visceral: 6, score: 86, heightM: 1.81 },
      { daysAgo: 62, weight: 81.5, bf: 15.1, whr: 0.85, visceral: 6, score: 85, heightM: 1.81 },
      { daysAgo: 90, weight: 80.2, bf: 15.6, whr: 0.86, visceral: 7, score: 83, heightM: 1.81, notes: "Intake reading." },
    ]),
    ...bodyComp(trainerId, ids.priya, [
      { daysAgo: 8,  weight: 58.2, bf: 21.4, whr: 0.74, visceral: 4, score: 91, heightM: 1.68 },
      { daysAgo: 40, weight: 58.8, bf: 22.0, whr: 0.74, visceral: 4, score: 90, heightM: 1.68 },
      { daysAgo: 71, weight: 59.4, bf: 22.6, whr: 0.75, visceral: 5, score: 89, heightM: 1.68, notes: "Intake reading." },
    ]),
  ];
  const { error } = await supabase.from("client_health_metrics").insert(rows);
  if (error) throw error;
  console.log(`+ ${rows.length} body-composition readings`);
}

// ─── 6. screenings, clearance, assessments ──────────────────────────────────
async function seedScreenings(trainerId, ids, ex) {
  const clean = {
    heart_condition: false, chest_pain_activity: false, chest_pain_rest: false,
    dizziness: false, bone_joint: false, blood_pressure_med: false, other_reason: false,
    free_text: "",
  };
  const rows = [
    {
      trainer_id: trainerId, client_id: ids.priya, submitted_at: iso(86 * DAY),
      parq: clean,
      medical_history: {
        previous_injuries: ["Right ITB syndrome (2023, resolved)"],
        medications: [], beta_blockers: false,
        chronic: { hypertension: false, diabetes: false, anemia: false, asthma: false },
        notes: "Mild ITB tightness in high-mileage blocks; foam-rolls daily.",
      },
      cvd_risk: { age: 34, sex: "f", family_history: false, smoking: false, inactivity: false, obesity: false, bmi: 20.6, waist_cm: 70 },
    },
    {
      trainer_id: trainerId, client_id: ids.james, submitted_at: iso(94 * DAY),
      parq: clean,
      medical_history: {
        previous_injuries: ["Left shoulder impingement (2022, resolved)"],
        medications: [], beta_blockers: false,
        chronic: { hypertension: false, diabetes: false, anemia: false, asthma: false },
        notes: "Overhead pressing fine since physio discharge; keeps a band warm-up.",
      },
      cvd_risk: { age: 29, sex: "m", family_history: false, smoking: false, inactivity: false, obesity: false, bmi: 25.8, waist_cm: 84 },
    },
    {
      trainer_id: trainerId, client_id: ids.sarah, submitted_at: iso(88 * DAY),
      parq: { ...clean, blood_pressure_med: true, free_text: "On amlodipine for borderline hypertension, reviewed annually." },
      medical_history: {
        previous_injuries: [], medications: ["Amlodipine 5 mg"], beta_blockers: false,
        chronic: { hypertension: true, diabetes: false, anemia: false, asthma: false },
        notes: "GP happy with moderate-intensity exercise; avoid heavy valsalva.",
      },
      cvd_risk: { age: 41, sex: "f", family_history: true, smoking: false, inactivity: true, obesity: true, bmi: 27.6, waist_cm: 89 },
    },
    {
      trainer_id: trainerId, client_id: ids.tom, submitted_at: iso(9 * DAY),
      parq: { ...clean, bone_joint: true, dizziness: true, free_text: "Lower-back flare three weeks ago, occasional light-headedness standing up fast." },
      medical_history: {
        previous_injuries: ["L4/L5 disc bulge (2021)", "Lower-back flare (current)"],
        medications: ["Ibuprofen as needed"], beta_blockers: false,
        chronic: { hypertension: false, diabetes: false, anemia: false, asthma: false },
        notes: "Awaiting a physio letter before loaded hinging resumes.",
      },
      cvd_risk: { age: 47, sex: "m", family_history: true, smoking: false, inactivity: true, obesity: false, bmi: 26.4, waist_cm: 94 },
    },
    {
      trainer_id: trainerId, client_id: ids.kaming, submitted_at: iso(21 * DAY),
      parq: clean,
      medical_history: {
        previous_injuries: [], medications: [], beta_blockers: false,
        chronic: { hypertension: false, diabetes: false, anemia: false, asthma: false },
        notes: "No history of note. Desk-based job, eight hours seated.",
      },
      cvd_risk: { age: 31, sex: "m", family_history: false, smoking: false, inactivity: true, obesity: false, bmi: 23.1, waist_cm: 80 },
    },
  ];
  const { error } = await supabase.from("client_screenings").insert(rows);
  if (error) throw error;

  // Tom's PAR-Q flags gate training until written clearance arrives.
  // (His injury_history is set in seedInjuries, after the screening trigger has
  // had its say — see the note there.)
  await supabase.from("clients").update({
    training_blocked: true,
    training_blocked_reason: "PAR-Q flags (joint + dizziness) — loaded training paused pending written medical clearance.",
  }).eq("id", ids.tom);

  // Sarah's BP medication flagged, clearance already received.
  await supabase.from("clients").update({
    clearance_received_at: iso(80 * DAY),
    clearance_note: "GP letter received: moderate-intensity exercise approved, avoid sustained valsalva.",
  }).eq("id", ids.sarah);

  // Posture: Ka Ming is the desk-bound upper-crossed case.
  const { error: postErr } = await supabase.from("postural_assessments").insert([{
    trainer_id: trainerId, client_id: ids.kaming, assessed_at: iso(20 * DAY),
    upper_crossed: "moderate",
    upper_crossed_notes: "Forward head ~4 cm, rounded shoulders, weak deep neck flexors. Eight hours seated daily.",
    lower_crossed: "mild",
    lower_crossed_notes: "Mild anterior pelvic tilt; hip flexors short, glutes under-recruiting.",
    pronation_distortion: "none",
    scoliosis: "none",
  }]);
  if (postErr) throw postErr;

  // First-lesson assessment battery (planner-designed) for two clients.
  const { error: fitErr } = await supabase.from("fitness_assessments").insert([
    {
      trainer_id: trainerId, client_id: ids.james, assessed_at: iso(92 * DAY),
      designed_by: "planner_agent",
      battery: {
        battery: [
          { test: "Bench press 3RM", rationale: "Baseline upper-body max strength for the hypertrophy block.", contraindication_check: "Shoulder impingement resolved — cleared with band warm-up." },
          { test: "Pull-up max reps", rationale: "Relative-strength anchor for vertical pulling volume.", contraindication_check: "No contraindication." },
          { test: "Plank hold", rationale: "Anti-extension endurance before loaded carries.", contraindication_check: "No contraindication." },
        ],
        skipped: [{ test: "Overhead press 3RM", reason: "Deferred one block given shoulder history; retest after four weeks." }],
      },
      results: { bench_3rm_kg: 92.5, pull_up_count: 11, plank_seconds: 108, handgrip_kg: 54, sit_and_reach_cm: 2 },
      notes: "Strong pressing base, pulling lags. Programme biases rows and chin-ups 2:1 over pressing.",
    },
    {
      trainer_id: trainerId, client_id: ids.sarah, assessed_at: iso(86 * DAY),
      designed_by: "planner_agent",
      battery: {
        battery: [
          { test: "Rockport 1-mile walk (VO₂ estimate)", rationale: "Submaximal aerobic baseline — appropriate with BP medication.", contraindication_check: "Submaximal by design; HR cap 75% max per GP letter." },
          { test: "Push-up count", rationale: "Upper-body endurance baseline.", contraindication_check: "No contraindication." },
          { test: "Sit-and-reach", rationale: "Posterior-chain flexibility before hinge loading.", contraindication_check: "No contraindication." },
        ],
        skipped: [{ test: "1RM testing", reason: "Maximal effort with valsalva avoided on antihypertensives." }],
      },
      results: { rockport_vo2: 29.4, push_up_count: 9, plank_seconds: 42, sit_and_reach_cm: -4, handgrip_kg: 28 },
      notes: "Aerobic base low-average; start zone-2 bias and build to 150 min/week before intensity.",
    },
  ]);
  if (fitErr) throw fitErr;
  console.log(`+ ${rows.length} screenings, 1 postural, 2 first-lesson assessments`);
}

// ─── 7. injury log ──────────────────────────────────────────────────────────
async function seedInjuries(trainerId, ids) {
  // Inserting a screening fires sync_client_injury_history (0039), which folds
  // previous_injuries + notes + the PAR-Q free text into ONE trail entry per
  // client and seeds clients.injury_history from it. So by the time we get here
  // every screened client already has an open entry — including ones whose
  // history is old news. Resolve those (the trainer's explicit override; the row
  // stays as the audit record) and clear the auto-seeded status text, leaving
  // only the two clients who genuinely need a programming adjustment.
  // Priya and James: genuine past injuries, so keep the auto-entry and close it.
  const pastInjury = [ids.priya, ids.james];
  const { error: resolveErr } = await supabase
    .from("client_injury_log")
    .update({ resolved_at: iso(30 * DAY) })
    .in("client_id", pastInjury)
    .eq("source", "screening");
  if (resolveErr) throw resolveErr;

  // Sarah and Ka Ming reported no injury at all — their auto-entry is just the
  // screening's free-text notes, which reads as nonsense on an injury chip.
  const noInjury = [ids.sarah, ids.kaming];
  const { error: delErr } = await supabase
    .from("client_injury_log").delete().in("client_id", noInjury).eq("source", "screening");
  if (delErr) throw delErr;

  const { error: clearErr } = await supabase
    .from("clients").update({ injury_history: null }).in("id", [...pastInjury, ...noInjury]);
  if (clearErr) throw clearErr;

  const rows = [
    // Open — these two drive the dashboard's "open injuries" card.
    { client_id: ids.tom, trainer_id: trainerId, source: "trainer", created_at: iso(6 * DAY), resolved_at: null,
      note: "Confirmed in person: pain on end-range flexion, no neuro signs. Hinging and axial loading pulled from the plan until the physio letter lands." },
    { client_id: ids.sarah, trainer_id: null, source: "client_report", created_at: iso(2 * DAY), resolved_at: null,
      note: "Left knee grumbled on the stairs after Saturday's long walk — not painful during the session." },
  ];
  const { error } = await supabase.from("client_injury_log").insert(rows);
  if (error) throw error;

  // Re-assert Tom's canonical status: the trigger seeded it from his
  // questionnaire text, and the trainer's wording is what the agents read.
  await supabase.from("clients").update({
    injury_history: "Active lower-back flare (L4/L5 history). No loaded hinging or axial compression until written clearance.",
  }).eq("id", ids.tom);

  console.log(`+ ${rows.length} injury-log entries (${pastInjury.length} auto-entries closed, ${noInjury.length} removed)`);
}

// ─── 8. programmes + sessions ───────────────────────────────────────────────
async function seedPrograms(trainerId, ids, ex) {
  const weekStart = mondayOfThisWeek();
  const programs = [
    {
      trainer_id: trainerId, client_id: ids.james, week_start: weekStart,
      plan: {
        days: [
          { day: "Mon", focus: "Upper — horizontal push/pull", exercises: [
            { exercise_id: ex("Barbell Bench Press"), sets: 4, reps: "6-8", notes: "RPE 8, 2 min rest. Band pull-apart warm-up first." },
            { exercise_id: ex("Barbell Bent Over Row"), sets: 4, reps: "8-10", notes: "Pulling bias — 2:1 over pressing this block." },
            { exercise_id: ex("Incline Dumbbell Press"), sets: 3, reps: "10-12", notes: "Controlled 3-count lowering." },
            { exercise_id: ex("Face Pull"), sets: 3, reps: "15", notes: "Shoulder-health work, keep it submaximal." },
          ] },
          { day: "Tue", focus: "Lower — hinge priority", exercises: [
            { exercise_id: ex("Romanian Deadlift"), sets: 4, reps: "6-8", notes: "Hinge, soft knees, mid-shin depth." },
            { exercise_id: ex("Bulgarian Split Squat"), sets: 3, reps: "10 each", notes: "Rear foot elevated, torso tall." },
            { exercise_id: ex("Leg Curl"), sets: 3, reps: "12-15" },
            { exercise_id: ex("Plank"), sets: 3, reps: "45 s" },
          ] },
          { day: "Thu", focus: "Upper — vertical push/pull", exercises: [
            { exercise_id: ex("Chin-Up"), sets: 4, reps: "8-10", notes: "Add load once 10 clean reps land." },
            { exercise_id: ex("Dumbbell Shoulder Press"), sets: 4, reps: "8-10", notes: "Seated, no lumbar extension." },
            { exercise_id: ex("Lat Pull Down"), sets: 3, reps: "12" },
            { exercise_id: ex("Dumbbell Overhead Triceps Extension"), sets: 3, reps: "12-15" },
          ] },
          { day: "Sat", focus: "Lower — squat priority + carries", exercises: [
            { exercise_id: ex("Front Squat"), sets: 4, reps: "5", notes: "Elbows high, full-depth only if the rack position holds." },
            { exercise_id: ex("Barbell Hip Thrust"), sets: 3, reps: "10" },
            { exercise_id: ex("Step-Up"), sets: 3, reps: "10 each" },
            { exercise_id: ex("Hanging Leg Raise"), sets: 3, reps: "12" },
          ] },
        ],
      },
    },
    {
      trainer_id: trainerId, client_id: ids.sarah, week_start: weekStart,
      plan: {
        days: [
          { day: "Mon", focus: "Full body — machine-led, HR capped", exercises: [
            { exercise_id: ex("Goblet Squat"), sets: 3, reps: "12", notes: "Breathe out on the way up — no valsalva (BP medication)." },
            { exercise_id: ex("Machine Seated Chest Press"), sets: 3, reps: "12" },
            { exercise_id: ex("Machine Seated Row"), sets: 3, reps: "12" },
            { exercise_id: ex("Dead Bug"), sets: 3, reps: "8 each" },
          ] },
          { day: "Wed", focus: "Zone 2 aerobic", exercises: [
            { exercise_id: ex("Rowing Machine"), sets: 1, reps: "30 min", notes: "HR cap 75% max. Conversational pace throughout." },
            { exercise_id: ex("Pallof Press"), sets: 3, reps: "10 each" },
          ] },
          { day: "Fri", focus: "Full body — load progression", exercises: [
            { exercise_id: ex("Leg Press"), sets: 3, reps: "12", notes: "Add 5 kg from last week if all sets hit 12." },
            { exercise_id: ex("Lat Pull Down"), sets: 3, reps: "12" },
            { exercise_id: ex("Cable / Band Triceps Press Down"), sets: 3, reps: "15" },
            { exercise_id: ex("Plank"), sets: 3, reps: "30 s" },
          ] },
        ],
      },
    },
    {
      trainer_id: trainerId, client_id: ids.tom, week_start: weekStart,
      plan: {
        days: [
          { day: "Tue", focus: "Corrective — no loaded hinge (clearance pending)", exercises: [
            { exercise_id: ex("Dead Bug"), sets: 3, reps: "8 each", notes: "Ribs down, no lumbar arching. Stop at any symptom." },
            { exercise_id: ex("Plank"), sets: 3, reps: "20 s", notes: "Short holds, perfect position." },
            { exercise_id: ex("Barbell Hip Thrust"), sets: 2, reps: "12", notes: "Bodyweight only until the physio letter arrives." },
          ] },
          { day: "Fri", focus: "Corrective — anti-rotation + aerobic", exercises: [
            { exercise_id: ex("Pallof Press"), sets: 3, reps: "10 each", notes: "Light band, slow." },
            { exercise_id: ex("Rowing Machine"), sets: 1, reps: "15 min", notes: "Easy pace, stop on any back symptom." },
          ] },
        ],
      },
    },
    {
      trainer_id: trainerId, client_id: ids.kaming, week_start: weekStart,
      plan: {
        days: [
          { day: "Mon", focus: "Pull progression + posture", exercises: [
            { exercise_id: ex("Band Assisted Pull Up"), sets: 4, reps: "5", notes: "Drop one band thickness when 5×5 is clean." },
            { exercise_id: ex("Machine Seated Row"), sets: 3, reps: "12" },
            { exercise_id: ex("Face Pull"), sets: 3, reps: "15", notes: "Desk-posture work — upper-crossed pattern." },
            { exercise_id: ex("Dumbbell Bent Over Reverse Fly"), sets: 3, reps: "12", notes: "Rear-delt work to balance the desk posture." },
          ] },
          { day: "Thu", focus: "Push + hinge base", exercises: [
            { exercise_id: ex("Push-Up"), sets: 3, reps: "10-12" },
            { exercise_id: ex("Goblet Squat"), sets: 3, reps: "12" },
            { exercise_id: ex("Dumbbell Stiff Leg Deadlift"), sets: 3, reps: "10" },
            { exercise_id: ex("Plank"), sets: 3, reps: "40 s" },
          ] },
        ],
      },
    },
  ];
  const { error } = await supabase.from("programs").insert(programs);
  if (error) throw error;

  // Explicit trainer-scheduled sessions: a past one carrying feedback the
  // Last-Session Analysis reads, plus upcoming ones for the calendar.
  const sessions = [
    {
      trainer_id: trainerId, client_id: ids.james, scheduled_at: at(-2, 7), duration_min: 60,
      title: "Upper — vertical", focus: "Chin-ups + pressing", status: "done",
      exercises: [
        { exercise_id: ex("Chin-Up"), sets: 4, reps: "8", order: 1 },
        { exercise_id: ex("Dumbbell Shoulder Press"), sets: 4, reps: "8", order: 2 },
        { exercise_id: ex("Lat Pull Down"), sets: 3, reps: "12", order: 3 },
      ],
      feedback: "Form broke down on the last set of shoulder press — elbows flared and he hunted for lumbar extension. Drop the load 5% next week and add a band pull-apart between sets. Chin-ups were clean at 4×8, ready for load.",
      feedback_at: iso(2 * DAY),
    },
    {
      trainer_id: trainerId, client_id: ids.priya, scheduled_at: at(-1, 6, 30), duration_min: 45,
      title: "Strength support", focus: "Single-leg + posterior chain", status: "done",
      exercises: [
        { exercise_id: ex("Romanian Deadlift"), sets: 3, reps: "8", order: 1 },
        { exercise_id: ex("Bulgarian Split Squat"), sets: 3, reps: "10", order: 2 },
        { exercise_id: ex("Calf Raise"), sets: 3, reps: "15", order: 3 },
      ],
      feedback: "Held position well after Sunday's 29 km. Right glute-med still the weaker side — keep the split-squat tempo at 3 counts down.",
      feedback_at: iso(1 * DAY),
    },
    { trainer_id: trainerId, client_id: ids.sarah, scheduled_at: at(0, 9), duration_min: 45,
      title: "Full body", focus: "Machine-led, HR capped", status: "scheduled",
      exercises: [
        { exercise_id: ex("Goblet Squat"), sets: 3, reps: "12", order: 1 },
        { exercise_id: ex("Machine Seated Chest Press"), sets: 3, reps: "12", order: 2 },
        { exercise_id: ex("Machine Seated Row"), sets: 3, reps: "12", order: 3 },
      ] },
    { trainer_id: trainerId, client_id: ids.james, scheduled_at: at(0, 18), duration_min: 60,
      title: "Lower — squat priority", focus: "Front squat + carries", status: "scheduled",
      exercises: [
        { exercise_id: ex("Front Squat"), sets: 4, reps: "5", order: 1 },
        { exercise_id: ex("Barbell Hip Thrust"), sets: 3, reps: "10", order: 2 },
      ] },
    { trainer_id: trainerId, client_id: ids.kaming, scheduled_at: at(1, 8), duration_min: 45,
      title: "Pull progression", focus: "Assisted pull-up + posture", status: "scheduled",
      exercises: [
        { exercise_id: ex("Band Assisted Pull Up"), sets: 4, reps: "5", order: 1 },
        { exercise_id: ex("Face Pull"), sets: 3, reps: "15", order: 2 },
      ] },
    { trainer_id: trainerId, client_id: ids.tom, scheduled_at: at(2, 17), duration_min: 30,
      title: "Corrective", focus: "No loaded hinge — clearance pending", status: "scheduled",
      exercises: [
        { exercise_id: ex("Dead Bug"), sets: 3, reps: "8", order: 1 },
        { exercise_id: ex("Pallof Press"), sets: 3, reps: "10", order: 2 },
      ] },
    { trainer_id: trainerId, client_id: ids.priya, scheduled_at: at(3, 6, 30), duration_min: 45,
      title: "Tempo support", focus: "Hinge + calves", status: "scheduled",
      exercises: [{ exercise_id: ex("Romanian Deadlift"), sets: 3, reps: "8", order: 1 }] },
  ];
  const { error: sErr } = await supabase.from("sessions").insert(sessions);
  if (sErr) throw sErr;
  console.log(`+ ${programs.length} weekly programmes, ${sessions.length} sessions`);
}

// ─── 9. progress reports + nutrition ────────────────────────────────────────
async function seedAgentOutput(trainerId, ids) {
  // created_at = today, so ProgressPanel's autoRun sees a fresh review and the
  // capture is deterministic instead of waiting on a live LLM call.
  const reports = [
    {
      trainer_id: trainerId, client_id: ids.priya,
      period_start: dayStr(-28), period_end: dayStr(0), created_at: iso(4 * 60_000),
      summary: [
        "**Four-week trend — on track for the sub-3:30 block.**",
        "",
        "- Volume up from 46 km to **58 km/week** with average HR holding at 128 bpm on easy runs — aerobic efficiency is improving, not just accumulating fatigue.",
        "- Sunday long runs now 26–29 km with HR drift under 5% in the back half. That is the single best signal in the block.",
        "- Tempo sessions sit in zone 4 for 28 min, up from 19 min four weeks ago.",
        "",
        "**Watch:** the jump from 52 → 58 km landed in one week. Hold 58 for a second week before stepping up, and keep Monday genuinely easy — last Monday crept into zone 3.",
      ].join("\n"),
      flags: [
        { kind: "volume_jump", severity: "medium", rationale: "Weekly distance rose 11.5% in a single step (52 → 58 km); repeat the week before progressing.", raised_at: iso(4 * 60_000) },
        { kind: "easy_day_drift", severity: "low", rationale: "Monday easy run averaged 141 bpm — zone 3, not the intended zone 2.", raised_at: iso(4 * 60_000) },
      ],
    },
    {
      trainer_id: trainerId, client_id: ids.sarah,
      period_start: dayStr(-28), period_end: dayStr(0), created_at: iso(6 * 60_000),
      summary: [
        "**Month four — composition moving the right way.**",
        "",
        "- Weight down **1.1 kg** with fat-free mass flat at 51.0 kg: the loss is coming off fat, not muscle.",
        "- Body fat 30.1% → **28.6%**, visceral fat level 8 → 7.",
        "- Aerobic volume steady at 24–26 km/week, all under the 75% HR cap the GP letter asks for.",
        "",
        "**Watch:** a self-reported left-knee grumble after Saturday's long walk. Nothing during sessions, but keep step-ups off the plan until it has been symptom-free for a week.",
      ].join("\n"),
      flags: [
        { kind: "self_reported_pain", severity: "medium", rationale: "Client reported left-knee discomfort after prolonged walking; monitor before reintroducing step-ups.", raised_at: iso(6 * 60_000) },
      ],
    },
    {
      trainer_id: trainerId, client_id: ids.james,
      period_start: dayStr(-28), period_end: dayStr(0), created_at: iso(9 * 60_000),
      summary: [
        "**Hypertrophy block, week 12 — lean mass is the story.**",
        "",
        "- Weight 83.1 → **84.6 kg** at an unchanged 15.2% body fat: roughly **+1.3 kg lean** in four weeks.",
        "- Chin-ups now 4×8–10 clean, up from 3×6. Ready for added load.",
        "- Pulling-to-pressing ratio held at 2:1 as programmed — the lag from the intake assessment is closing.",
        "",
        "**Watch:** shoulder-press technique degraded on the last set on Thursday (trainer note). Load drops 5% this week with a band pull-apart between sets.",
      ].join("\n"),
      flags: [
        { kind: "technique_breakdown", severity: "low", rationale: "Trainer observed elbow flare and lumbar compensation on the final shoulder-press set; load reduced 5%.", raised_at: iso(9 * 60_000) },
      ],
    },
  ];
  const { error } = await supabase.from("progress_reports").insert(reports);
  if (error) throw error;

  const meals = [
    {
      trainer_id: trainerId, client_id: ids.sarah, week_start: mondayOfThisWeek(),
      plan: {
        type: "advice",
        generated_at: iso(5 * 3_600_000),
        advice: [
          "### Where the numbers point",
          "",
          "At 71.4 kg with 51.0 kg fat-free mass, maintenance sits near **2,050 kcal**. You are averaging a ~400 kcal deficit, which matches the 1.1 kg/month you are actually losing — keep it there rather than cutting deeper.",
          "",
          "### Protein first",
          "",
          "Target **115–125 g/day** (1.6–1.8 g per kg of lean mass). That is what is protecting the lean mass on the InBody trend. Easiest wins:",
          "",
          "- Breakfast is the gap — currently ~12 g. Greek yoghurt or two eggs takes it to 25 g.",
          "- Keep a 30 g protein anchor at lunch and dinner.",
          "",
          "### Sodium, because of the amlodipine",
          "",
          "Keep added salt modest and watch restaurant soups and sauces. Nothing restrictive — just don't stack a high-sodium day on top of a long walk in the heat.",
          "",
          "### Around Wednesday's zone-2 row",
          "",
          "30 min at a conversational pace needs no special fuelling. Eat normally; have the protein anchor within a couple of hours afterwards.",
        ].join("\n"),
      },
    },
    {
      trainer_id: trainerId, client_id: ids.priya, week_start: mondayOfThisWeek(),
      plan: {
        type: "advice",
        generated_at: iso(6 * 3_600_000),
        advice: [
          "### Fuelling 58 km/week",
          "",
          "At 58.2 kg and this volume, carbohydrate is the lever — not protein, which is already adequate at ~95 g/day.",
          "",
          "- **Easy days:** 5–6 g carbs per kg (~300–350 g).",
          "- **Long-run and tempo days:** 7–8 g per kg (~410–465 g). Front-load it; do not try to catch up at dinner.",
          "",
          "### Long run specifics",
          "",
          "Beyond 90 minutes take **45–60 g carbs per hour**. At 26–29 km that means practising race fuelling now, not in taper week.",
          "",
          "### Iron",
          "",
          "Female endurance athlete at rising volume — worth a ferritin check at the next GP visit. Nothing in the screening flags it, but it is the deficiency that quietly flattens a block.",
        ].join("\n"),
      },
    },
  ];
  const { error: mErr } = await supabase.from("meal_plans").insert(meals);
  if (mErr) throw mErr;
  console.log(`+ ${reports.length} progress reports, ${meals.length} nutrition plans`);
}

// ─── 10. messaging ──────────────────────────────────────────────────────────
async function seedMessages(trainerId, ids) {
  const thread = async (clientId, handle) => {
    const { data, error } = await supabase.from("messaging_threads")
      .insert({ trainer_id: trainerId, client_id: clientId, channel: "telegram", external_handle: handle })
      .select("id").single();
    if (error) throw error;
    return data.id;
  };
  const jamesThread = await thread(ids.james, "@james_okafor");
  const priyaThread = await thread(ids.priya, "@priya_runs");
  const sarahThread = await thread(ids.sarah, "@sarah_m");

  const msgs = [
    // Outbound agent drafts read like the Messaging agent wrote them.
    { client_id: ids.james, thread_id: jamesThread, direction: "outbound", body: "Morning James 💪 Thursday's chin-ups were clean at 4×8 — nice work. We're dropping the shoulder press 5% today and adding band pull-aparts between sets, so the last set stays as tight as the first. See you at 6.", sent_at: iso(0.3 * DAY) },
    { client_id: ids.james, thread_id: jamesThread, direction: "inbound",  body: "Sounds good. Shoulder felt fine after, just tired by the end 👍", sent_at: iso(0.25 * DAY) },
    { client_id: ids.james, thread_id: jamesThread, direction: "outbound", body: "That's exactly the right kind of tired — it was fatigue, not the shoulder. Keep the band warm-up and we'll add load to the chin-ups next week 🎯", sent_at: iso(0.2 * DAY) },

    { client_id: ids.priya, thread_id: priyaThread, direction: "outbound", body: "Great long run on Sunday Priya — 29 km with under 5% HR drift in the back half is the best number in the block so far 🙌 We're holding 58 km again this week rather than stepping up, so Monday stays genuinely easy (zone 2, conversational).", sent_at: iso(1.2 * DAY) },
    { client_id: ids.priya, thread_id: priyaThread, direction: "inbound",  body: "Noted! I did feel like Monday got away from me a bit", sent_at: iso(1.1 * DAY) },
    { client_id: ids.priya, thread_id: priyaThread, direction: "outbound", body: "It did — 141 bpm average, which is zone 3. Easy days being genuinely easy is what makes the tempo days work ✨", sent_at: iso(1.05 * DAY) },

    { client_id: ids.sarah, thread_id: sarahThread, direction: "inbound",  body: "Left knee grumbled a bit on the stairs after the long walk on Saturday. Fine during training though", sent_at: iso(2.1 * DAY) },
    { client_id: ids.sarah, thread_id: sarahThread, direction: "outbound", body: "Thanks for flagging it — I've logged it 📋 Nothing to worry about, but I'm pulling step-ups off the plan until it's been quiet for a week. Friday's leg press stays, it loads the knee in a much friendlier line.", sent_at: iso(2 * DAY) },
    { client_id: ids.sarah, thread_id: sarahThread, direction: "outbound", body: "Also — this month's InBody is in: 1.1 kg down with lean mass completely flat 🎉 That's the split we were aiming for. Body fat 30.1% → 28.6%.", sent_at: iso(0.5 * DAY) },
  ].map((m) => ({ trainer_id: trainerId, channel: "telegram", status: "sent", ...m }));

  const { error } = await supabase.from("messages").insert(msgs);
  if (error) throw error;
  console.log(`+ ${msgs.length} messages across 3 Telegram threads`);
}

// ─── 11. change requests, invites, scheduled agents ─────────────────────────
async function seedWorkflow(trainerId, ids) {
  const { error: pcrErr } = await supabase.from("program_change_requests").insert([
    { trainer_id: trainerId, client_id: ids.sarah, status: "pending", created_at: iso(0.4 * DAY),
      body: "Could we move Friday's session to Saturday morning this week? I have a work trip Friday afternoon and would rather not rush it." },
    { trainer_id: trainerId, client_id: ids.kaming, status: "pending", created_at: iso(1.4 * DAY),
      body: "想問可以加多啲背部訓練嗎？想快啲做到第一下 pull-up 💪" },
    { trainer_id: trainerId, client_id: ids.james, status: "approved", created_at: iso(9 * DAY), resolved_at: iso(8 * DAY),
      trainer_note: "Approved — swapped Saturday's front squats to Sunday for that week only.",
      body: "Any chance of shifting Saturday to Sunday? Away at a wedding." },
  ]);
  if (pcrErr) throw pcrErr;

  // A pending invite so the dashboard's invite strip has something in it.
  const { error: invErr } = await supabase.from("onboarding_invites").insert([
    { trainer_id: trainerId, client_id: ids.kaming, token: `demo-invite-${randomBytes(8).toString("hex")}`,
      expires_at: iso(-12 * DAY), created_at: iso(1 * DAY) },
    { trainer_id: trainerId, client_id: ids.ella, token: `demo-invite-${randomBytes(8).toString("hex")}`,
      expires_at: iso(-10 * DAY), created_at: iso(3 * DAY), accepted_at: iso(2 * DAY) },
  ]);
  if (invErr) throw invErr;

  const nextRun = (hoursAhead) => iso(-hoursAhead * 3_600_000);
  const { error: saErr } = await supabase.from("scheduled_agents").insert([
    // client_ids is NOT NULL with a '{}' default, and a supabase-js batch insert
    // fills keys a row omits with explicit nulls — so every row sets it.
    { trainer_id: trainerId, name: "Morning session reminder", flow: "daily-reminder",
      target_all: true, client_ids: [], frequency: "daily", hour: 7, minute: 0, tz_offset_minutes: -480,
      enabled: true, last_run_at: iso(0.6 * DAY), next_run_at: nextRun(16) },
    { trainer_id: trainerId, name: "Sunday check-in", flow: "weekly-checkin",
      target_all: false, client_ids: [ids.priya, ids.james, ids.sarah],
      frequency: "weekly", weekday: 0, hour: 18, minute: 30, tz_offset_minutes: -480,
      enabled: true, last_run_at: iso(4 * DAY), next_run_at: nextRun(72) },
    { trainer_id: trainerId, name: "Post-session nudge", flow: "post-session-nudge",
      target_all: true, client_ids: [], frequency: "daily", hour: 20, minute: 0, tz_offset_minutes: -480,
      enabled: false, last_run_at: null, next_run_at: nextRun(30) },
  ]);
  if (saErr) throw saErr;
  console.log("+ 3 change requests, 2 invites, 3 scheduled agents");
}

// ─── 12. knowledge base ─────────────────────────────────────────────────────
// Chunks go in without embeddings: retrieval is hybrid, so full-text search
// still finds and cites them, and a capture doesn't need an embedding API call.
async function seedKnowledge(trainerId) {
  const docs = [
    {
      title: "ACSM Guidelines for Exercise Testing and Prescription (11th ed.) — pre-participation chapter",
      source_type: "pdf", default_tags: ["planner", "progress"],
      chunks: [
        "Pre-participation health screening should identify individuals with medical contraindications to exercise, those who require medical clearance before beginning an exercise programme, and those with clinically significant disease who would benefit from a medically supervised programme. The algorithm considers current activity level, known cardiovascular, metabolic or renal disease, signs or symptoms of such disease, and the intensity of exercise the individual intends to perform.",
        "For an individual who is currently inactive and has no known disease and no signs or symptoms, light-to-moderate intensity exercise may begin without medical clearance, progressing gradually. An individual with known cardiovascular, metabolic or renal disease who is asymptomatic and already exercising may continue at moderate intensity without clearance, but should obtain clearance before progressing to vigorous intensity.",
        "Exercise prescription follows the FITT-VP principle: frequency, intensity, time, type, volume and progression. For cardiorespiratory fitness in healthy adults, the recommendation is at least 150 minutes per week of moderate-intensity activity, 75 minutes of vigorous activity, or an equivalent combination. Resistance training should address each major muscle group two to three days per week with 48 hours between sessions for the same group.",
      ],
    },
    {
      title: "Schoenfeld et al. — Dose–response of weekly resistance-training volume on muscle hypertrophy",
      source_type: "article", source_url: "https://pubmed.ncbi.nlm.nih.gov/27433992/", default_tags: ["planner"],
      chunks: [
        "A graded dose–response relationship exists between weekly resistance-training volume and muscle hypertrophy. Studies comparing weekly set volumes report greater gains with higher volumes, with meaningful increases observed up to approximately ten or more sets per muscle group per week. Returns diminish beyond that point and recovery capacity becomes the limiting factor.",
        "Training to momentary muscular failure is not required for hypertrophy when volume is equated. Sets taken close to failure — within one to three repetitions in reserve — produce comparable growth with less neuromuscular fatigue, which allows higher weekly volume to be tolerated across a training block.",
        "Hypertrophy occurs across a broad spectrum of loading, from roughly 30% to 85% of one-repetition maximum, provided sets are taken near failure. Heavier loading remains superior for maximal strength expression, so a block aimed at both outcomes should include a heavy component rather than relying on high-repetition work alone.",
      ],
    },
    {
      title: "AASFP Advanced Personal Trainer manual — AFT enhancement levels",
      source_type: "docx", default_tags: ["planner", "exercise_coach"],
      chunks: [
        "The All-round Fitness Training enhancement system classifies clients into five levels. Blue denotes dysfunctional or deconditioned individuals requiring corrective work on a stable base with simple movement patterns. Green denotes prepared individuals ready for general aerobic conditioning and basic resistance training. Yellow covers active and recreational athletes who tolerate higher skill demands, hypertrophy work and interval training.",
        "Orange denotes trained athletes working at maximal strength and power, with complex and unstable movement patterns and advanced progressions. Red is reserved for elite and professional athletes whose programming is sport-specific and carries the highest complexity. A client's level is reassessed as capacity changes, and exercise selection is drawn from the matching level rather than from a generic beginner-to-advanced ladder.",
        "Exercise selection must respect contraindications before level. An orange-level athlete with an acute lumbar episode is programmed from the blue-level corrective catalogue for that movement pattern until symptoms resolve and clearance is in place, while continuing at their own level for unaffected patterns.",
      ],
    },
    {
      title: "Managing exercise in clients on antihypertensive medication",
      source_type: "url", source_url: "https://www.heart.org/en/health-topics/high-blood-pressure", default_tags: ["planner", "nutrition", "progress"],
      chunks: [
        "Clients taking calcium-channel blockers such as amlodipine may experience peripheral oedema and a blunted heart-rate response is uncommon, unlike beta-blockers where heart rate is suppressed and rating of perceived exertion should guide intensity instead. An extended cool-down reduces the risk of post-exercise hypotension.",
        "Sustained valsalva during heavy resistance training produces large transient rises in blood pressure and is best avoided in hypertensive clients. Programme submaximal loads with controlled exhalation through the concentric phase, and favour machine-based or supported movements over maximal free-weight attempts.",
        "Aerobic exercise at moderate intensity produces reductions in resting systolic blood pressure of roughly five to seven mmHg in hypertensive populations. A minimum of 150 minutes per week accumulated across most days is the target, and the effect of a single session on blood pressure can persist for up to 24 hours.",
      ],
    },
    {
      title: "Lower-back pain return-to-training progression (clinic handout)",
      source_type: "pdf", default_tags: ["planner", "exercise_coach", "progress"],
      chunks: [
        "Early-stage management of a non-specific lower-back episode prioritises pain-free movement, isometric trunk control and gradual reintroduction of hip hinging without external load. Anti-extension and anti-rotation drills such as the dead bug and Pallof press are tolerated well because they load the trunk without end-range spinal movement.",
        "Progression criteria rather than fixed timelines should govern the return to loaded hinging: symptom-free daily activity, pain-free unloaded hinge through full range, and the ability to hold a neutral-spine plank for sixty seconds. Loading then resumes at approximately forty per cent of the previous working weight and increases by ten per cent weekly in the absence of symptoms.",
        "Red flags requiring medical referral rather than programme modification include progressive neurological deficit, saddle anaesthesia, bladder or bowel dysfunction, unexplained weight loss and night pain unrelieved by position change.",
      ],
    },
  ];

  let chunkTotal = 0;
  for (const d of docs) {
    const { data, error } = await supabase.from("knowledge_docs").insert({
      trainer_id: trainerId,
      title: d.title,
      source_type: d.source_type,
      source_url: d.source_url ?? null,
      default_tags: d.default_tags,
      status: "ready",
      chunk_count: d.chunks.length,
    }).select("id").single();
    if (error) throw error;

    const rows = d.chunks.map((content, i) => ({
      doc_id: data.id, trainer_id: trainerId, chunk_index: i, content,
      agent_tags: d.default_tags, tags_confirmed: true,
    }));
    const { error: cErr } = await supabase.from("knowledge_chunks").insert(rows);
    if (cErr) throw cErr;
    chunkTotal += rows.length;
  }
  console.log(`+ ${docs.length} knowledge docs, ${chunkTotal} chunks`);
}

// ─── run ────────────────────────────────────────────────────────────────────
await reset();
const trainerId = await createTrainer();
const ids = await createClients(trainerId);
await createClientLogins();
const ex = await exerciseIds();
await seedActivities(trainerId, ids);
await seedBodyComp(trainerId, ids);
await seedScreenings(trainerId, ids, ex);
await seedInjuries(trainerId, ids);
await seedPrograms(trainerId, ids, ex);
await seedAgentOutput(trainerId, ids);
await seedMessages(trainerId, ids);
await seedWorkflow(trainerId, ids);
await seedKnowledge(trainerId);

// Never print the password — this runs from the capture pipeline, so anything
// logged here lands in terminal scrollback.
console.log(`\nDone. Showcase trainer: ${DEMO_TRAINER_EMAIL}`);
console.log(`Client portal logins:   ${CLIENTS.map((c) => c.email).join(", ")}`);
if (!pinnedPassword) {
  console.log(
    "\n  NOTE: neither SEED_DEMO_PASSWORD nor SEED_TEST_PASSWORD was set, so a\n" +
      "  random password was used and is NOT recoverable. Set one in the root\n" +
      "  .env and re-run before capturing.",
  );
}
