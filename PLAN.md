# Gym Days — Comprehensive Milestone Plan

Reference doc for the full build. `README.md` is the live status board; this file is the spec each milestone is built against.

**Rule**: one milestone = one feature = one concrete test = one README row flipped to ✅. Do not start the next milestone until the current test passes.

---

## Stack & Repo Layout

- **Frontend**: Next.js 15 (App Router) + TypeScript + Tailwind CSS · Recharts for charts
- **Backend**: Supabase — Postgres + pgvector + Auth + Storage + Edge Functions (Deno) + pg_cron
- **AI service**: Python + FastAPI + CrewAI (separate process; Edge Functions are Deno/TS so cannot host CrewAI)
- **Integrations**: Strava (pull + webhook), Open Food Facts (nutrition default), provider-agnostic messaging
- **Env**: all execution inside conda env `gymDays` — `source env.sh` first

Layout:
- [web/](web/) — Next.js app
- [ai/](ai/) — Python FastAPI + CrewAI service
- [supabase/](supabase/) — migrations + Edge Functions + RLS tests
- [env.sh](env.sh) — activates conda + prepends `$CONDA_PREFIX/bin` to PATH so Node 20 wins over nvm
- [README.md](README.md) — milestone status board
- [PLAN.md](PLAN.md) — this file

---

## Architecture Overview

```
┌─────────────────────┐         ┌──────────────────────┐
│  Next.js webapp     │◄───────►│  Supabase            │
│  (trainer console + │   RLS   │  - Postgres+pgvector │
│   client onboarding)│         │  - Auth              │
└──────────┬──────────┘         │  - Storage           │
           │ HTTPS              │  - Edge Functions    │
           ▼                    │  - pg_cron           │
┌─────────────────────┐         └──────────┬───────────┘
│  AI Service (Python)│◄───────────────────┘ webhooks
│  FastAPI + CrewAI   │
│  + Flows (cron)     │
└──────────┬──────────┘
           ├──► Strava API (OAuth + webhook subscriptions)
           ├──► Nutrition API (Open Food Facts; Nutritionix fallback)
           └──► MessagingProvider ──► Console | WhatsApp | Telegram | Email
```

---

## CrewAI 5-Agent Crew

Each agent runs scoped to a single `client_id`. Tools enforce that scope (refuse cross-client reads). All runs logged to `agent_runs`.

| # | Agent       | Role                         | Tools                                                                                       | Trigger                                          |
|---|-------------|------------------------------|---------------------------------------------------------------------------------------------|--------------------------------------------------|
| 1 | Onboarding  | First-signup intake          | `write_client_profile`, `write_client_memory`                                              | Client completes intake form                     |
| 2 | Planner     | Weekly workout plan          | `get_client_profile`, `get_recent_activities`, `search_exercise_db`, `read_calendar`, `write_program` | Onboarding complete; weekly Flow                 |
| 3 | Nutrition   | Macros + meal plan           | `get_client_profile`, `get_active_program`, `lookup_food`, `write_meal_plan`               | After Planner each week                          |
| 4 | Progress    | Trend analysis + flags       | `get_recent_activities`, `get_workout_logs`, `search_client_memory`, `write_progress_report`, `raise_flag` | Weekly Flow; event-driven on new Strava activity |
| 5 | Messaging   | Check-ins / nudges / reminders | `get_client_profile`, `get_active_program`, `get_progress_report`, `send_message` (via `MessagingProvider`) | CrewAI Flows on cron + Progress-flag events      |

### CrewAI Flows (cron-orchestrated)

Defined in [ai/crew/flows.py](ai/crew/flows.py); triggered by Supabase `pg_cron` calling an Edge Function that hits the AI service.

- `onboarding_flow(client_id)` → Onboarding → Planner → Nutrition → Messaging (welcome)
- `weekly_planning_flow(client_id)` → Planner → Nutrition
- `weekly_review_flow(client_id)` → Progress → (conditional) Messaging
- `daily_reminder_flow(client_id)` → Messaging
- `post_session_nudge_flow(client_id)` → Messaging

---

## Data Model (Supabase / Postgres)

All tables scoped via RLS by `trainer_id`. `client_memory` additionally scoped per-client.

- `trainers` — auth user, profile, settings
- `clients` — name, contact, goals, equipment, schedule, strava_athlete_id, messaging handles, preferred_channel
- `programs` — weekly training plan written by Planner (week → sessions → exercises)
- `meal_plans` — written by Nutrition; references program week
- `workouts` — completed/logged sessions, RPE, notes
- `activities` — raw Strava activities (one row per Strava webhook event), normalized metrics
- `messages` — outbound + inbound, channel, status (`sent | failed | received`)
- `messaging_threads` — provider-agnostic conversation handle
- `progress_reports` — Progress agent output, `flags jsonb`
- `client_memory` — `(id, client_id, kind, content, embedding vector(1536), created_at)` · pgvector similarity search · RLS-isolated by `client_id`
- `agent_runs` — audit log per crew/flow execution (inputs, outputs, cost, latency)
- `integration_tokens` — encrypted Strava OAuth tokens per client
- `exercise_db` — curated exercise library (seeded once)
- `food_cache` — cached Open Food Facts lookups

`kind` enum on `client_memory`: `onboarding_note | preference | constraint | progress_summary | message_log | nutrition_note`.

**Memory isolation enforced two ways**:
1. RLS policy on `client_memory` — agent service uses a scoped JWT carrying `client_id`
2. Tool layer — every memory tool requires `client_id` and refuses cross-client reads

---

## Milestones

### M0 — Repo skeleton ✅
- **Deliverable**: `web/` scaffolded (Next.js + TS + Tailwind); `ai/`, `supabase/` dirs; `README.md` milestone table; `.gitignore`; `env.sh` for conda activation.
- **Test**: `npm run dev` boots cleanly on the configured port; default page renders HTTP 200.

### M1 — Dashboard.html visual port ✅
- **Goal**: Pixel-faithful React/Next.js port of the Claude Design `Dashboard.html` with mock data.
- **Deliverable**:
  - [web/app/globals.css](web/app/globals.css) — earth-tone radial gradient bg + noise + `.glass` primitive (top gloss `::before`, edge refraction `::after` via `mask-composite`) + tints `moss / ochre / terracotta / sage`
  - [web/app/layout.tsx](web/app/layout.tsx) — Inter + Share Tech Mono via Google Fonts; `suppressHydrationWarning` on `<html>` (extension safety)
  - [web/app/(dashboard)/layout.tsx](web/app/(dashboard)/layout.tsx) + [page.tsx](web/app/(dashboard)/page.tsx) — shell + dashboard view
  - [web/lib/design-tokens.ts](web/lib/design-tokens.ts), [web/lib/mock.ts](web/lib/mock.ts)
  - Components: [Glass](web/components/glass/Glass.tsx), [Sidebar](web/components/dashboard/Sidebar.tsx), [TopBar](web/components/dashboard/TopBar.tsx), [DashboardShell](web/components/dashboard/DashboardShell.tsx), [MetricCard](web/components/dashboard/MetricCard.tsx), [DotNumber](web/components/dashboard/DotNumber.tsx), [StreakDots](web/components/dashboard/StreakDots.tsx), [StatusBadge](web/components/dashboard/StatusBadge.tsx), [AgentBadge](web/components/dashboard/AgentBadge.tsx), [StravaLogo](web/components/dashboard/StravaLogo.tsx), [ClientProgressChart](web/components/dashboard/ClientProgressChart.tsx), [ClientTable](web/components/dashboard/ClientTable.tsx), [AgentFeed](web/components/dashboard/AgentFeed.tsx), [icons](web/components/dashboard/icons.tsx)
- **Test** ([web/tests/dashboard.spec.ts](web/tests/dashboard.spec.ts) — 8/8 passing):
  1. Top-bar title + 4 metric labels render
  2. Sidebar contains all 5 nav items
  3. Client table renders 5 rows incl. Sarah Mitchell
  4. Agent feed renders 5 timeline items
  5. Chart SVG renders 3 line series
  6. Body computed bg = `rgb(28, 36, 24)`
  7. `.glass::before` and `::after` resolve gradient backgrounds (specular + refraction)
  8. Add Client button visible in top bar

### M2 — Supabase schema + RLS ⏳
- **Goal**: Schema in version-controlled SQL; RLS isolates trainers and per-client memory.
- **Deliverable**: [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql) — all tables (see Data Model), `pgvector` + `pg_cron` extensions, RLS policies, indexes on `(trainer_id)`, `(client_id, created_at)`, ivfflat index on `client_memory.embedding`.
- **Test** ([supabase/tests/rls.sql](supabase/tests/rls.sql) via `supabase db test`):
  1. Trainer A inserts a client; trainer B's session cannot SELECT it
  2. `client_memory` tagged `client_id=X` invisible when JWT carries `client_id=Y`

### M3 — Trainer auth + live client list ⏳
- **Goal**: Replace mock `clients` array with live Supabase data; sidebar shows logged-in trainer.
- **Deliverable**: Supabase Auth (email magic link), `web/lib/supabase/{client,server}.ts`, [web/app/login/page.tsx](web/app/login/page.tsx), `middleware.ts` redirect for unauth users, `ClientTable` reads `clients` for current trainer.
- **Test** ([web/tests/auth.spec.ts](web/tests/auth.spec.ts)):
  1. Signing in as seeded trainer renders only their clients
  2. Logged-out GET `/` redirects to `/login`

### M4 — Client creation + onboarding intake page ⏳
- **Goal**: "Add Client" creates a `clients` row; public onboarding link captures the client's answers.
- **Deliverable**: [web/app/(dashboard)/clients/new/page.tsx](web/app/(dashboard)/clients/new/page.tsx), [web/app/onboarding/[token]/page.tsx](web/app/onboarding/[token]/page.tsx), token-scoped writes.
- **Test** ([web/tests/onboarding.spec.ts](web/tests/onboarding.spec.ts)):
  1. POST a new client → row exists; appears in dashboard table
  2. Valid onboarding token saves answers; expired token returns 410

### M5 — AI service skeleton + Onboarding Agent (1/5) ⏳
- **Goal**: FastAPI service hosts CrewAI; Onboarding Agent persists structured profile + seeds embedded memory.
- **Deliverable**: [ai/main.py](ai/main.py), [ai/crew/agents.py](ai/crew/agents.py) (Onboarding only), [ai/crew/tools/client.py](ai/crew/tools/client.py) (`write_client_profile`, `write_client_memory`), embeddings via `text-embedding-3-small`. Endpoint `POST /flows/onboarding/{client_id}`.
- **Test** ([ai/tests/test_onboarding.py](ai/tests/test_onboarding.py)):
  1. Fixture transcript → `clients.profile` populated + ≥3 `client_memory` rows of `kind='onboarding_note'`
  2. Scoped tool refuses any `client_id` other than the one the run was started with

### M6 — Strava OAuth + activity pull ⏳
- **Goal**: Client connects Strava during onboarding; webhook ingests activities.
- **Deliverable**: [supabase/functions/strava-webhook/index.ts](supabase/functions/strava-webhook/index.ts), [ai/integrations/strava.py](ai/integrations/strava.py) (token refresh + activity fetch), recent-activities feed on client detail [web/app/(dashboard)/clients/[id]/page.tsx](web/app/(dashboard)/clients/[id]/page.tsx).
- **Test** ([ai/tests/test_strava.py](ai/tests/test_strava.py)):
  1. POST sample Strava webhook → `activities` row upserted
  2. Dashboard "Syncs Today" reflects today's count

### M7 — Planner Agent (2/5) ⏳
- **Goal**: Generate a weekly program from profile + last 14 days of `activities`.
- **Deliverable**: Planner agent + tools; seed `exercise_db`; program editor [web/app/(dashboard)/clients/[id]/program/page.tsx](web/app/(dashboard)/clients/[id]/program/page.tsx).
- **Test** ([ai/tests/test_planner.py](ai/tests/test_planner.py)):
  1. Returns 7-day plan; each day's `exercises[]` reference valid `exercise_db.id`s
  2. Plan visible & editable in editor

### M8 — Nutrition Agent (3/5) ⏳
- **Goal**: Macros + meal plan derived from program load, using Open Food Facts.
- **Deliverable**: Nutrition agent; [ai/integrations/nutrition.py](ai/integrations/nutrition.py) wraps Open Food Facts; `food_cache` table; meal plan UI on client detail.
- **Test** ([ai/tests/test_nutrition.py](ai/tests/test_nutrition.py)):
  1. Daily kcal within ±10% of computed target; every food maps to a `food_cache` row
  2. Re-run hits cache (mock HTTP counter does not increment)

### M9 — Progress Agent (4/5) + dashboard flags ⏳
- **Goal**: Weekly trend report; plateau/overtraining flags surfaced on dashboard.
- **Deliverable**: Progress agent + `raise_flag` tool; dashboard reads `progress_reports.flags` and renders the existing `StatusBadge` "Flagged".
- **Test** ([ai/tests/test_progress.py](ai/tests/test_progress.py)):
  1. Synthetic overtraining pattern (HRV drop + volume rise) → flag row with `kind='overtraining'`
  2. Playwright: flagged client appears with Flagged badge

### M10 — Messaging abstraction + Console provider ⏳
- **Goal**: Provider-agnostic interface; default `ConsoleProvider`; stubs for WhatsApp / Telegram / Email.
- **Deliverable**: [ai/messaging/provider.py](ai/messaging/provider.py) — `MessagingProvider` protocol, `ConsoleProvider`, `TwilioWhatsAppProvider`, `MetaWhatsAppProvider`, `TelegramBotProvider`, `EmailProvider` (stubs raise `NotConfigured`); `send_message` agent tool.
- **Test** ([ai/tests/test_messaging.py](ai/tests/test_messaging.py)):
  1. `ConsoleProvider.send()` writes a `messages` row with `status='sent'`
  2. Each stub raises `NotConfigured` until its env vars are set

### M11 — Messaging Agent (5/5) + Flows on cron ⏳
- **Goal**: Cron-triggered Flows fire scheduled outbound through the messaging abstraction; live `agent_runs` feed on dashboard.
- **Deliverable**: [ai/crew/flows.py](ai/crew/flows.py) (`daily_reminder_flow`, `weekly_checkin_flow`, `post_session_nudge_flow`); [supabase/functions/run-flow/index.ts](supabase/functions/run-flow/index.ts) called by `pg_cron`; `AgentFeed` reads `agent_runs` (replaces mock).
- **Test** ([ai/tests/test_flows.py](ai/tests/test_flows.py)):
  1. `daily_reminder_flow(client_id)` produces an `agent_runs` row + a `messages` row via `ConsoleProvider`
  2. `SELECT * FROM cron.job` shows each scheduled flow
  3. Dashboard agent feed renders live `agent_runs` rows

### M12 — Real messaging provider wire-up ⏳
- **Goal**: Pick WhatsApp provider (Twilio vs Meta Cloud API); wire credentials; no code outside the provider implementation changes.
- **Test**: manual e2e — send a real WhatsApp message to a test number through `weekly_checkin_flow`.

---

## Client Onboarding & First-Lesson Assessment Pipeline (M13–M18)

Goal of this phase: replace the placeholder `invite_submit(profile jsonb)` flow with a structured, clinically-grounded intake that the Planner agent and every downstream agent can reason over safely. Source-of-truth for the questionnaire content is the trainer-provided "Pre-training Screening Questionnaire" (PAR-Q → Medical/Injury History → CVD Risk → InBody/General Health → Postural & Functional Movement → Fitness Assessment List).

**Hard safety invariants** (enforced in DB constraints, tool guards, and UI banners):
- Any PAR-Q "Yes" → `medical_clearance_required = true`; Planner refuses to design max-effort tests until cleared.
- Resting BP ≥ 200/110 mmHg → `training_blocked = true`; Planner returns a "see physician" stub instead of a plan.
- Beta-blocker on medication list → cardio tests must be RPE-anchored, not HR-anchored.
- Two or more CVD risk factors flagged → max-effort cardio (1.5-mile, Chester max stage) excluded from designed test battery; sub-max only.

### M13 — Screening + assessment schema ⏳
- **Goal**: Permanent, RLS-scoped storage for every datum the questionnaire and first lesson produce; mirrored to `client_memory` so all agents pick it up via RAG.
- **Deliverable**: [supabase/migrations/0016_client_screenings.sql](supabase/migrations/0016_client_screenings.sql) creating:
  - `client_screenings` — one row per submitted PAR-Q. Cols: `id`, `client_id`, `trainer_id`, `parq jsonb` (7 yes/no items + free-text), `medical_history jsonb` (previous_injuries[], medications[], chronic_conditions[]), `cvd_risk jsonb` (age, family_history, smoking, inactivity, obesity flags + computed `risk_factor_count`), `medical_clearance_required boolean generated`, `submitted_at timestamptz`.
  - `client_health_metrics` — time-series. Cols: `id`, `client_id`, `recorded_at`, `bp_systolic int`, `bp_diastolic int`, `resting_hr int`, `weight_kg numeric`, `bmi numeric`, `body_fat_pct numeric`, `fat_free_mass_kg numeric`, `bmr_kcal int`, `waist_hip_ratio numeric`, `total_body_water_pct numeric`, `source text` (`'intake' | 'session' | 'self-report'`).
  - `postural_assessments` — one row per in-person assessment. Cols: structured findings for Upper Crossed, Lower Crossed, Pronation Distortion, Scoliosis (each `severity enum + notes`) + functional movement screen (Overhead Squat / Hip Hinge / Single-leg Squat / Wall Angel — pass/fail/compensation jsonb).
  - `fitness_assessments` — one row per test session. Cols: `battery jsonb` (which tests were chosen + why), `results jsonb` (3RM loads, plank time, push-up count, sit-and-reach cm, sub-max VO2 estimate, BESS error count), `designed_by text` (`'planner_agent' | 'trainer_manual'`).
  - `client_screenings_memory_sync` trigger → on insert/update, write a summarized row into `client_memory` with `kind='screening_note' | 'assessment_result' | 'postural_finding' | 'health_metric'` and an embedding (called via Edge Function so `text-embedding-3-small` runs server-side).
  - Extend the `client_memory.kind` enum with the four new values above.
- **Test** ([supabase/tests/screening_rls.sql](supabase/tests/screening_rls.sql)):
  1. Trainer A insert into `client_screenings` for client C → trainer B's JWT cannot SELECT it.
  2. PAR-Q row with any `yes` → `medical_clearance_required = true` automatically.
  3. Insert into `client_health_metrics` triggers a `client_memory` row with `kind='health_metric'`.

### M14 — Trainer invite UX + Telegram delivery ⏳
- **Goal**: One-click invite generation that the trainer can drop into Telegram (or copy as URL/QR). Extends the existing `onboarding_invites` table — no new schema.
- **Deliverable**:
  - "New Client" button in [web/app/(dashboard)/page.tsx](web/app/(dashboard)/page.tsx) opens a sheet: name + optional Telegram handle + "Generate invite". Creates `clients` stub row + `onboarding_invites` row with 7-day expiry.
  - Invite sheet shows: copyable short URL, QR code, "Send via Telegram" button.
  - "Send via Telegram" hits a new web route [web/app/api/invites/send-telegram/route.ts](web/app/api/invites/send-telegram/route.ts) that calls the existing `telegram-bridge` to DM the link (looks up `telegram_chat_id` if already known, otherwise generates a `t.me/<bot>?start=invite_<token>` deep link).
  - Trainer dashboard gains a "Pending invites" strip showing un-accepted invites with countdown.
- **Test** ([web/tests/invite_flow.spec.ts](web/tests/invite_flow.spec.ts)):
  1. Click "New Client" → submit → invite URL is rendered + appears in pending strip.
  2. Mock Telegram bridge: clicking "Send via Telegram" POSTs the expected payload.

### M15 — Public multi-step screening questionnaire + account creation ⏳
- **Goal**: Replace the single-form `/onboarding/[token]` with a guided, 3-part screening that builds the `client_screenings` row, then prompts the client to create a Supabase Auth account linked to the invite's `client_id`.
- **Deliverable**:
  - [web/app/onboarding/[token]/page.tsx](web/app/onboarding/[token]/page.tsx) — refactor into a stepper:
    1. **Part 1: Pre-training Screening** — PAR-Q (7 yes/no items, each with a one-line explainer) → Medical & Injury History (previous injuries free-text + medication multi-select including Beta-blockers flag + chronic condition checkboxes for Hypertension / Diabetes / Anemia / Asthma) → CVD Risk Factors (Age, family history, smoking, inactivity, obesity — auto-computed risk count).
    2. **Part 2: Account creation** — email + password → Supabase Auth signup → on success, write `client_id` ↔ `auth.uid()` link onto the `clients` row, then commit the screening via a new `invite_submit_screening(p_token, p_screening)` RPC.
    3. **Part 3: Confirmation** — show "Your trainer has been notified. Bring this checklist to your first session: …" auto-derived from screening.
  - On any PAR-Q "Yes", surface a non-blocking banner: "We recommend you obtain medical clearance before high-intensity training."
  - Bilingual labels (Traditional Chinese + English) matching the source questionnaire — extends [web/app/onboarding/[token]/page.tsx](web/app/onboarding/[token]/page.tsx) i18n using `clients.preferred_language` (set from screening UI).
  - New RPC `public.invite_submit_screening(p_token text, p_screening jsonb, p_auth_user_id uuid)` replaces direct writes to `clients.profile`.
- **Test** ([web/tests/screening_questionnaire.spec.ts](web/tests/screening_questionnaire.spec.ts)):
  1. Walk through all 3 parts → `client_screenings` row exists; `clients.auth_user_id` populated; invite marked accepted.
  2. Submitting with any PAR-Q "Yes" sets `medical_clearance_required = true` and shows banner before submit.
  3. Expired token returns 410 (regression of existing behavior).

### M16 — Trainer realtime notification + auto-filled client view ⏳
- **Goal**: The moment a client submits, the trainer sees the new client appear with structured intake auto-rendered and a generated "First Lesson Checklist".
- **Deliverable**:
  - Supabase Realtime publication on `client_screenings` (new migration enabling the table on the existing `supabase_realtime` publication).
  - [web/components/dashboard/NewClientToast.tsx](web/components/dashboard/NewClientToast.tsx) — subscribes via `postgres_changes`, raises a toast + bumps a badge on the sidebar "Clients" item.
  - [web/app/(dashboard)/clients/[id]/page.tsx](web/app/(dashboard)/clients/[id]/page.tsx) gains a `ScreeningSummary` panel: PAR-Q answers (red-flagged in terracotta), medications, chronic conditions, CVD risk count. A `FirstLessonChecklist` panel auto-derives "what to collect" from the screening (always: BP, RHR, InBody panel; conditional: skip max-effort tests if clearance pending).
- **Test** ([web/tests/trainer_notify.spec.ts](web/tests/trainer_notify.spec.ts)):
  1. Submit a screening in one browser context → toast fires in trainer context within 3 s.
  2. Client detail page renders the screening summary with at least one red-flagged item when a PAR-Q "Yes" is present.

### M17 — First-lesson assessment capture (in-person) ⏳
- **Goal**: Mobile-friendly trainer form to record everything the first session produces: vitals, InBody snapshot, postural analysis, functional movement screen, and the fitness test battery results.
- **Deliverable**:
  - [web/app/(dashboard)/clients/[id]/first-lesson/page.tsx](web/app/(dashboard)/clients/[id]/first-lesson/page.tsx) — 4-step capture:
    1. **Vitals & InBody** → writes `client_health_metrics` with `source='intake'`. Banner blocks save if BP ≥ 200/110 (per safety invariant) and flips `training_blocked = true`.
    2. **Static Postural Analysis** → 4 syndrome checkboxes + notes → `postural_assessments`.
    3. **Functional Movement Screen** → Overhead Squat / Hip Hinge / Single-leg Squat / Wall Angel, each pass/fail + compensation tags.
    4. **Fitness Test Battery** → form pre-populated by the Planner-agent `design_fitness_tests` call from M18; trainer enters results → `fitness_assessments`.
  - All four writes mirror to `client_memory` via the M13 trigger.
- **Test** ([web/tests/first_lesson.spec.ts](web/tests/first_lesson.spec.ts)):
  1. Complete all 4 steps → one row in each of `client_health_metrics`, `postural_assessments`, `fitness_assessments`; four new `client_memory` rows.
  2. Entering BP 210/115 surfaces the block-training banner and refuses to save the battery step.

### M18 — Planner agent: screening-aware test design + program gating ⏳
- **Goal**: Planner uses the new screening / postural / metric data to (a) design the safest fitness test battery for the first session, and (b) gate program output by safety invariants.
- **Deliverable**:
  - New CrewAI tool [ai/crew/tools/assessment.py](ai/crew/tools/assessment.py):
    - `get_client_screening(client_id)` — reads `client_screenings` + latest `client_health_metrics` + `postural_assessments`.
    - `design_fitness_tests(client_id)` — returns a battery from the Fitness Assessment List, excluding tests contraindicated by the safety invariants. Output schema: `{ battery: [{test, rationale, contraindication_check}], skipped: [{test, reason}] }`.
    - `write_fitness_assessment(client_id, battery, results)` — writes `fitness_assessments`.
  - Planner agent in [ai/crew/agents.py](ai/crew/agents.py) extended:
    - Reads screening + postural findings on every plan call (not just first).
    - Refuses to emit a program if `training_blocked`; emits a "see physician" stub instead.
    - Tags each prescribed exercise with `contra_check` referencing the screening item that allows it (e.g. `"cleared: no knee injury, no CVD red flag"`).
  - Progress, Nutrition, and Messaging agents inherit the new memory via existing `SearchClientMemory` (no per-agent change needed since M13's trigger seeds `client_memory`).
- **Test** ([ai/tests/test_planner_screening.py](ai/tests/test_planner_screening.py)):
  1. Fixture screening with PAR-Q chest-pain "Yes" → `design_fitness_tests` excludes 1.5-mile run + 3RM bench; substitutes Chester sub-max + handgrip.
  2. Fixture with BP 220/120 → planner returns `{ blocked: true, reason: "BP above safe threshold" }` and no exercises.
  3. Fixture with Beta-blocker medication → cardio test recommended with RPE target, not HR target.
  4. Planner output references at least one screening-derived constraint in its rationale (string match against the screening row's flagged items).

---

## Verification Pattern (per milestone)

1. Implement
2. Run that milestone's test command → green
3. Flip the README row's status to ✅ + link the passing test output / file
4. Move on

### M1 manual visual smoke test
```bash
source env.sh
cd web && npm run dev
# open http://localhost:3000 — compare against /tmp/design_bundle/gym-days/project/screenshots/glass-fix.png
```

---

## Pre-deployment Reminders

### ⚠️ Re-read /privacy and /terms before Strava submission
Before requesting Strava's multi-athlete rate-limit increase (or any other
public deployment), open these two pages and verify every claim is accurate
for the **real production deployment** — they were drafted from what I've
seen in code and may diverge from reality:

- [web/app/privacy/page.tsx](web/app/privacy/page.tsx)
- [web/app/terms/page.tsx](web/app/terms/page.tsx)

Specifically confirm:

- [ ] **Infrastructure providers listed match reality** — Supabase region, LLM
  providers actually used (Anthropic vs OpenAI vs both), any other data
  processors (analytics, error tracking, email).
- [ ] **Data residency** — privacy page implies "EU/US" for Supabase. Update to
  the actual region of your project.
- [ ] **Retention periods** — currently states "30 days" for deletion turnaround.
  Make sure that matches your actual deletion process / cron job.
- [ ] **Strava scopes requested** — privacy page lists `read,activity:read_all`.
  Cross-check against [web/lib/strava.ts:19](web/lib/strava.ts#L19); update if
  scopes change.
- [ ] **Telegram + messaging providers** — listed as Telegram only. Update when
  WhatsApp / email channels are added.
- [ ] **AI providers and "no training on data" claim** — verify the current
  Anthropic + OpenAI API contracts still match the wording. If you ever
  switch to a provider that trains on inputs, update the wording.
- [ ] **Effective dates** — bump the `EFFECTIVE` constant at the top of each
  page when you make any material change.
- [ ] **Support email** — currently hardcoded to `tobywong42r@outlook.com` in
  three places (`/support`, `/privacy`, `/terms`). If you set up a dedicated
  support address (e.g. `support@gymdays.app`), swap it everywhere.
- [ ] **Age limits** — terms state trainers ≥18, clients ≥16. Confirm this
  matches your actual intended audience.
- [ ] **Liability cap wording** — currently "amounts you paid us in the 12
  months prior". Make sure this matches your eventual billing model (if
  free, the cap is effectively zero — fine; if paid, revisit).

When you change either page, also re-submit it for review if Strava has
already approved the app and the changes are material (e.g. new data
providers, new data types collected, change to deletion process).

### ⚠️ Strava app settings to update before production deploy

In [strava.com/settings/api](https://www.strava.com/settings/api) for the
gymDays API app:

- [ ] **Authorization Callback Domain** — switch from `localhost` to the
  production host (e.g. `gymdays.app`). Domain only — no scheme, no path.
  Strava matches by domain, so one entry covers all routes on that host.
  The OAuth `redirect_uri` is built from `window.location.origin` in
  [StravaConnectButton.tsx:29](web/components/dashboard/StravaConnectButton.tsx#L29)
  and [PublicStravaConnect.tsx:27](web/app/connect/strava/[token]/PublicStravaConnect.tsx#L27),
  so the browser's host must match this setting.
- [ ] **Request multi-athlete rate-limit increase** — currently in
  single-athlete mode (only one Strava account can connect). After deploy,
  fill the Strava Google Form with:
    - Deployed **Support URL** ([/support](web/app/support/page.tsx))
    - Deployed **Privacy URL** ([/privacy](web/app/privacy/page.tsx))
    - Deployed **Terms URL** ([/terms](web/app/terms/page.tsx))
    - **App Images**: screenshots of every place Strava data renders —
      [StravaActivityChart](web/components/dashboard/StravaActivityChart.tsx),
      [HRHealthPanel](web/components/dashboard/HRHealthPanel.tsx),
      [StravaPanel](web/components/dashboard/StravaPanel.tsx),
      [public connect page](web/app/connect/strava/[token]/page.tsx). Each
      must show the "Powered by Strava" attribution.
- [ ] **Register the Strava webhook subscription** for the production env —
  one-time `POST` to `https://www.strava.com/api/v3/push_subscriptions`
  with the prod callback URL. The handler at
  [api/strava/webhook/route.ts](web/app/api/strava/webhook/route.ts) is
  already in place; only the subscription registration needs to happen.

### ⚠️ Strava brand assets

[web/public/strava/](web/public/strava/) currently contains the official
files. Confirm before each deploy:

- [ ] `btn_strava_connect_with_orange_x2.png` — official PNG present (used by
  [ConnectWithStravaButton.tsx](web/components/strava/ConnectWithStravaButton.tsx))
- [ ] `api_logo_pwrdBy_strava_horiz_orange.png` — official PNG present (used
  by [PoweredByStrava.tsx](web/components/strava/PoweredByStrava.tsx))
- [ ] If a file is missing, the components fall back to in-app text
  approximations — visually close but **not brand-compliant**. See
  [web/public/strava/README.md](web/public/strava/README.md).

### ⚠️ Re-enable email confirmation before production (M15 signup)

During smoke testing of M15 the "Confirm email" toggle was turned **off** in
Supabase dashboard → Authentication → Sign In / Providers → Email to bypass
the free-tier rate limit (~3–4 confirmation emails/hour). Before any real
client signs up, this must be turned back on — otherwise anyone can claim
someone else's email address during onboarding.

Production checklist:

- [ ] **Re-enable "Confirm email"** in the Supabase dashboard.
- [ ] **Pick an email transport**: either stay on default Supabase email
  (3–4/hour cap — fine for low signup volume), or configure custom SMTP
  (Resend / SendGrid / Postmark) under **Authentication → SMTP Settings**
  to lift the limit.
- [ ] **Update [ScreeningStepper.tsx](web/components/onboarding/ScreeningStepper.tsx)
  submit flow** to handle the case where `signup.user` exists but no session
  is returned (the user hasn't clicked the confirmation link yet). The
  `client_screenings` row still gets written via the RPC, but the existing
  step-5 "All done" confirmation should become a "Check your email to finish
  setting up your account" screen instead. Currently the stepper assumes
  immediate session creation, which is only true when confirmation is off.

### ⚠️ Production environment variables

- [ ] `CRON_SECRET` set to a strong random value (not the `dev-secret`
  fallback) in the production env so the pg_cron jobs in 0009 / 0011 / 0013
  can authenticate against the daily-sync / backfill-suffer endpoints.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` present — the public Strava prepare/
  callback flow uses it to read/write across RLS boundaries.
- [ ] `STRAVA_CLIENT_ID` (server) + `NEXT_PUBLIC_STRAVA_CLIENT_ID` (browser)
  set to the prod Strava app's Client ID.
- [ ] `STRAVA_CLIENT_SECRET` set.
- [ ] `STRAVA_VERIFY_TOKEN` matches whatever was used at webhook
  subscription registration.

### ⚠️ Migrations to verify applied in production

Use the SQL editor to confirm each is present. If you're missing any, apply
in order:

- [ ] **0008** `messages_realtime.sql` — enables Supabase Realtime on the
  messages table; without it the live Telegram-chat mirroring on the client
  page silently doesn't fire.
- [ ] **0009** `backfill_suffer_cron.sql` — initial daily backfill cron.
- [ ] **0011** `backfill_suffer_hourly.sql` — hourly variant; the
  per-100-activity cap added to
  [api/strava/backfill-suffer](web/app/api/strava/backfill-suffer/[client_id]/route.ts)
  relies on this cron to chew through the rest of any backlog.
- [ ] **0013** `strava_daily_cron.sql` — nightly incremental sync for all
  connected clients.
- [ ] **0015** `strava_connect_tokens.sql` — the new client-facing invite
  flow table + `strava_connect_lookup` / `strava_connect_consume` RPCs.

Verify with:
```sql
select jobname, schedule, active from cron.job
where jobname ilike '%strava%' or jobname ilike '%suffer%' or jobname ilike '%message%';
```

### ⚠️ Verify all pg_cron jobs before production deploy

Run this to confirm all jobs are present, scheduled correctly, and active:

```sql
select jobid, jobname, schedule, active from cron.job order by jobid;
```

Expected jobs:

| ID | Name | Schedule (UTC) | HKT | Notes |
|----|------|---------------|-----|-------|
| 1 | `gymdays-daily-reminder` | `0 10 * * *` | 18:00 daily | Fires only for clients with a session tomorrow (`fire_daily_reminder()`) |
| 2 | `gymdays-weekly-checkin` | `0 9 * * 1` | 17:00 Mon | All Active clients |
| 5 | `gymdays-strava-backfill-suffer` | `0 * * * *` | hourly | Backfills suffer scores |
| 6 | `gymdays-strava-daily-sync` | `0 0 * * *` | 08:00 daily | Nightly Strava sync for all connected clients |

If any job is missing, re-apply its migration SQL or run `cron.schedule(name, schedule, command)` directly.

### ⚠️ Post-workout refuel reminder — Strava webhook setup required

The real-time post-workout refuel message fires via the **Strava webhook**, not a cron job. It is **not active** until the Strava push subscription is registered.

Flow: client finishes workout → Strava pushes `create` event → `web/app/api/strava/webhook/route.ts` ingests activity → calls `triggerPostWorkoutAnalysis(client_id)` → AI sends Telegram refuel message.

Before going live, confirm:

- [ ] **Strava push subscription registered** — check:
  ```bash
  curl "https://www.strava.com/api/v3/push_subscriptions?client_id=CLIENT_ID&client_secret=CLIENT_SECRET"
  # Must return a non-empty array with your prod callback URL
  ```
  If empty, register it:
  ```bash
  curl -X POST https://www.strava.com/api/v3/push_subscriptions \
    -d client_id=CLIENT_ID \
    -d client_secret=CLIENT_SECRET \
    -d callback_url=https://YOUR_DOMAIN/api/strava/webhook \
    -d verify_token=STRAVA_VERIFY_TOKEN
  ```
- [ ] **`AI_SERVICE_URL` set in the web app's prod env** — defaults to `localhost:8001`, must point to the deployed AI service. The webhook calls the AI service directly to trigger the flow.
- [ ] **Telegram set up for each client** — the refuel message is sent via Telegram. Clients must have `telegram_chat_id` populated and the bot linked before any message can reach them.

### Deferred work surfaced during the Strava-connect build

Not strictly required, but worth picking up later:

- [ ] **Auto-deliver invite links via Telegram** — currently the
  [StravaInviteButton](web/components/dashboard/StravaInviteButton.tsx)
  generates a URL the trainer copies and pastes into whatever channel they
  use. A "Send via Telegram" follow-up would tie it into the existing
  Telegram bridge (mirrors the deep-link flow described in
  [README.md:90](README.md#L90)).
- [ ] **Auto-trigger full historical sync on first connect** — earlier
  iteration of the callback awaited a full-sync before redirecting to
  `/connect/strava/done`; this was reverted to keep the redirect fast.
  Two alternate paths if you want it back: (a) fire-and-forget with
  `after()` from `next/server`, (b) move the sync onto the done page as a
  client-side fetch with progress. Right now the user has to click
  **Sync now** or wait for the nightly cron.
- [ ] **First-time Backfill HR data sweep** — after a fresh connection,
  ~50–100 activities will need streams pulled. The hourly cron handles
  this automatically, but the trainer can hit
  **Backfill HR data (N)** in [StravaActivityChart](web/components/dashboard/StravaActivityChart.tsx)
  to process the first batch immediately. Add this to onboarding docs.
- [ ] **End-to-end test in incognito** — open a fresh invite URL in a
  private browser window, complete the OAuth, confirm
  `integration_tokens` row + `strava_athlete_id` populate, and the
  `strava_connect_tokens.used_at` is stamped. Tracked separately from the
  trainer-popup Playwright tests.
- [ ] **Privacy/ToS/Support email** — currently hardcoded to
  `tobywong42r@outlook.com` in the three `/support /privacy /terms` page
  files. Swap to a dedicated `support@<your-domain>` when you have one.

---

## Open Decisions Deferred to Implementation

- **AI service hosting** — Fly.io / Railway / Cloud Run (decide at M5)
- **Embedding model** — default `text-embedding-3-small`; revisit at M5 if cost spikes
- **Scheduler** — Supabase `pg_cron` → Edge Function → AI service vs in-process APScheduler in AI service (decide at M11)
- **Nutrition provider** — Open Food Facts default; Nutritionix only if branded-food coverage blocks (decide at M8)
- **WhatsApp provider** — Twilio vs Meta Cloud API (decide at M12)
- **Token encryption** — Supabase Vault vs app-layer KMS (decide at M6)

---

## Design Reference

`Dashboard.html` from the Claude Design handoff bundle (`/tmp/design_bundle/gym-days/`).
- Aesthetic: earth-tone moss/ochre/terracotta/sage radial gradients + Apple liquid-glass cards
- Glass technique: gradient highlights + inset shadows + `mask-composite` edge ring (no `backdrop-filter` — Chromium compositor issue with nested flex)
- Type: `Inter` (UI) + `Share Tech Mono` (dot-matrix numerals)
- Layout: 220px sidebar + 64px top bar + (4 metric cards / chart / clients + agent feed)

---

## 🔔 PRE-DEPLOYMENT REMINDER

Before any production deploy that uses Strava data: re-read Strava's current
API agreement (https://www.strava.com/legal/api) and confirm the AI-use and
athlete-only-display clauses, OR migrate Strava-derived AI/insight features
onto a compliant source (aggregator / Garmin / Fitbit). **Do not ship the
AI-on-Strava-data path without this check.**

**Aggregator (Terra / ROOK) — note for scale:** A single API normalizes
300–500+ devices (Garmin, Fitbit, Oura, Whoop, Apple Health, Google) into one
webhook/schema, HIPAA-compliant, and explicitly permits AI use and
trainer-sharing (unlike Strava). If you find yourself maintaining 3+ direct
OAuth flows, switching the ingestion layer to an aggregator becomes the
lower-cost path. Keep existing Strava for now.

**Suggested workflow improvement (more efficient ingestion):** Abstract the
ingestion layer behind a single internal `ProviderAdapter` interface
(`fetch_activities` / `handle_webhook` / `normalize → canonical schema`) so
Strava is just one adapter today. This (1) decouples AI/insight features from
any single provider's ToS, (2) makes the aggregator swap a one-adapter change
rather than a rewrite, and (3) lets the AI pipeline consume only the
normalized canonical schema — never raw Strava payloads — which is the same
boundary the compliance check above needs anyway.
