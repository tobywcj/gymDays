# Gym Days

AI-powered client management webapp for personal trainers — a CrewAI agent crew (planner, nutrition, progress, messaging, concierge, exercise coach), Strava ingestion, Telegram messaging, per-client AI memory, clinical pre-training screening, a trainer knowledge base (RAG), and a client portal.

## Setup

All code runs inside the `gymDays` conda env.

```bash
source env.sh                 # activates conda + fixes PATH so node 20 wins over nvm

# AI service (FastAPI + CrewAI) on :8001
set -a && source .env && set +a
uvicorn ai.main:app --reload --port 8001

# Web (dashboard + portal) on :3000
cd web && npm install && npm run dev
```

Env is split: root `.env` feeds the AI service and scripts; `web/.env.local` feeds Next.js. Most API keys (LLM providers, Strava secret) can instead be entered per trainer at **`/api-keys`**, and Telegram at **`/connections`** — env values are only the fallback.

### Database

The cloud Supabase project is the source of truth. Migrations live in `supabase/migrations/` (`0001`–`0051`).

```bash
npm run db:push     # apply pending migrations (session-mode 5432 URL, handled by the script)
npm run db:check    # verify every table/column/function the migrations create exists on cloud
```

`db:check` exists because a migration can be recorded in `supabase_migrations` history without its DDL having run (happened with `0021` and `0038`). If it reports anything missing, re-run that migration's idempotent SQL directly, then `NOTIFY pgrst, 'reload schema'`.

## Tests

```bash
# AI service — runs pytest from the repo root (running from ai/ lets ai/secrets.py
# shadow stdlib `secrets`). Append `-- -m live` for opt-in tests that call real LLM APIs.
npm run test:ai

# Web — Playwright; boots `next dev` on :3478 and reseeds the test trainers
npm run test:web

# SQL RLS
npm run test:sql                # supabase/run-tests.sh --cloud — rollback-safe suites only
supabase/run-tests.sh           # local .pgdata cluster
```

> ⚠️ `supabase/tests/rls.sql` and `screening_rls.sql` **TRUNCATE trainers/clients**. They are local-only; `run-tests.sh --cloud` refuses any test file containing `TRUNCATE`. New SQL tests should follow `portal_rls.sql`: one `BEGIN … ROLLBACK` transaction with dedicated fixture UUIDs.

Python and Playwright tests write throwaway rows to the cloud DB and clean up after themselves. Playwright pins the UI to English via an `app_lang=en` cookie (the app defaults to 繁中).

## Milestone Status

Rule: every closed milestone flips its row to ✅ and links the passing test. 🟡 = shipped but no automated test yet.

### Phase 1 — Core platform

| #   | Feature                              | Status | Test                                  |
|-----|--------------------------------------|--------|---------------------------------------|
| M0  | Repo skeleton                        | ✅      | `npm run dev` boots                   |
| M1  | Dashboard visual port                | ✅      | `web/tests/dashboard.spec.ts` (7/7)   |
| M2  | Supabase schema + RLS                | ✅      | `supabase/tests/rls.sql` (local)      |
| M3  | Trainer auth + live client list      | ✅      | `web/tests/auth.spec.ts` (4/4)        |
| M4  | Client creation + onboarding intake  | 🟡      | — (`onboarding.spec.ts` no longer exists) |
| M5  | Onboarding Agent                     | ✅      | `ai/tests/test_onboarding.py` (6/6)   |
| M6  | Strava OAuth + activity pull         | ✅      | `web/tests/strava.spec.ts` (5/5)      |
| M7  | Planner Agent                        | ✅      | `ai/tests/test_planner.py` (6/6)      |
| M8  | Nutrition Agent (markdown food advice) | ✅    | `ai/tests/test_nutrition.py` (5/5)    |
| M9  | Progress Agent + flags               | ✅      | `ai/tests/test_progress.py` (5/5) + `web/tests/progress.spec.ts` (2/2) |
| M10 | Messaging abstraction                | ✅      | `ai/tests/test_messaging.py` (11/11)  |
| M11 | Messaging Agent + Flows cron         | ✅      | `ai/tests/test_flows.py` (5/5) + `web/tests/flows.spec.ts` (1/1) |
| M12 | Telegram provider (free + official)  | ✅      | `ai/tests/test_messaging.py` Telegram (mocked HTTP) + `web/tests/connections.spec.ts` (3/3) |

### Phase 2 — Clinical screening, clearance & knowledge base

| #   | Feature                              | Status | Test                                  |
|-----|--------------------------------------|--------|---------------------------------------|
| M13 | Screening + assessment schema (PAR-Q, CVD risk, clearance) | ✅ | `supabase/tests/screening_rls.sql` (local) |
| M14 | Trainer invite UX + Telegram delivery | ✅      | `web/tests/connections.spec.ts`       |
| M15 | Public multi-step screening questionnaire + account creation | ✅ | `web/tests/screening_questionnaire.spec.ts` (4/4) |
| M16 | Trainer realtime notification + auto-filled client view | ✅ | `0016_client_screenings.sql` (realtime) |
| M17 | First-lesson assessment capture (in-person) | ✅ | `web/tests/screening_questionnaire.spec.ts` |
| M18 | Planner: screening-aware test design + program gating | ✅ | `ai/tests/test_planner_screening.py` (7/7) |
| KB  | Trainer knowledge base (hybrid vector + FTS + rerank, per-agent summaries, citations) | 🟡 | — |

### Phase 3 — Client portal, trainer tooling & data integrations

| #   | Feature                              | Migrations | Status | Test |
|-----|--------------------------------------|------------|--------|------|
| M19 | Client accounts + portal (`/portal`: programme, insights, settings) | 0025 | ✅ | `supabase/tests/portal_rls.sql` (clients_self_read) |
| M20 | Sessions calendar + post-session feedback | 0030, 0034 | ✅ | `portal_rls.sql` |
| M21 | Programme library: AASFP exercise DB, bilingual, illustrations, trainer flags, client caveats | 0027–0029, 0031–0032, 0035, 0046–0047 | 🟡 | — |
| M22 | Bring-your-own API keys (`/api-keys`, `trainer_secrets`) | 0036 | ✅ | `portal_rls.sql` |
| M23 | Program-change requests (portal → trainer approval) + Health Insight Tree | 0038 | ✅ | `portal_rls.sql` + `web/tests/phase3.spec.ts` |
| M24 | Injury log (trainer / screening / client reports, resolve) | 0037, 0039–0043 | ✅ | `portal_rls.sql` |
| M25 | AFT 5-level (blue→red) client + exercise classification | 0045 | ✅ | `ai/tests/test_output_parsers.py` (6/6) |
| M26 | Scheduled agents (trainer-defined cron, pg_cron dispatch every 5 min) | 0049 | ✅ | `web/tests/phase3.spec.ts` + `portal_rls.sql` |
| M27 | InBody / BIA photo OCR (Claude vision) + extra metrics | 0050 | ✅ | `ai/tests/test_inbody_ocr.py` (23/23) |
| M28 | Per-client, per-agent data-source toggles | 0051 | ✅ | `ai/tests/test_agent_source_prefs.py` (6/6) + `portal_rls.sql` |
| M29 | Strava hardening: token-rotation races, deauthorization webhook, UI-managed secret | — | ✅ | `ai/tests/test_strava_tokens.py` (4/4) + `web/tests/phase3.spec.ts` |
| M30 | TOTP MFA (`/security`, `/mfa`) | — | 🟡 | — |
| M31 | HR health, screening readiness, session analysis, exercise coach/research flows | — | 🟡 | readiness parser in `test_output_parsers.py`; flows untested |

`portal_rls.sql` (8/8) · `phase3.spec.ts` (13/13).

## Architecture

- **web/** — Next.js 15 (App Router) + TypeScript. Trainer dashboard (`/`, `/clients`, `/programme`, `/knowledge`, `/connections`, `/api-keys`, `/security`), client portal (`/portal`), public onboarding/screening (`/onboarding/[token]`) and Strava connect (`/connect/strava/[token]`). 75 API routes; AI calls stream from the AI service.
- **ai/** — Python FastAPI + CrewAI service: agents in `ai/crew/agents.py`, flows in `ai/crew/flows.py`, tools in `ai/crew/tools/`, InBody OCR in `ai/vision/`, knowledge-base retrieval in `ai/knowledge.py`.
- **supabase/** — migrations `0001`–`0051`, RLS on every table, pg_cron jobs (agent dispatch every 5 min, Strava daily sync, suffer-score backfill, daily reminder, weekly check-in), Realtime on `activities`, `messages`, `client_screenings`, `sessions`.
- **telegram-bridge/** — Node long-poller that forwards inbound Telegram messages to the AI service (no public URL needed).

## Messaging providers

Messaging runs on **Telegram** — free, official, and ToS-clean (no per-message
fees, no ban risk). Trainers configure their bot in the UI at **`/connections`**
— no `.env` edits needed. Credentials are stored per-trainer (RLS-scoped, in
`messaging_credentials`).

| Provider   | Channel  | Credentials          | Status  |
|------------|----------|----------------------|---------|
| `console`  | console  | _(none)_             | ✅ live (default; logs to stderr) |
| `telegram` | telegram | `bot_token`          | ✅ live (outbound + inbound) |
| `email`    | email    | `api_key`, `from`    | stub    |

Provider resolution order at runtime:

1. Explicit creds passed to `get_provider()` (used by the Test endpoint)
2. DB credentials for the current trainer
3. Environment variables (`TELEGRAM_BOT_TOKEN`, etc.) — fallback for cron paths

### Two-way Telegram (clients message the agent)

```bash
# 1. AI service (handles inbound → concierge agent)
source env.sh && set -a && source .env && set +a
uvicorn ai.main:app --port 8001

# 2. Telegram bridge (long-polls; no public URL / ngrok needed)
cd telegram-bridge && TELEGRAM_BOT_TOKEN=... npm start
```

**Setup:**
1. Create a bot with [@BotFather](https://t.me/BotFather), copy the token.
2. On **`/connections`**, paste the token under Telegram → Test + Save (or set `TELEGRAM_BOT_TOKEN`).
3. Start the bridge (above).
4. On a client's profile page, copy their **Telegram deep link** (`t.me/<bot>?start=<client_id>`) and send it to the client.
5. The client taps it → the bot links their chat (`clients.telegram_chat_id` is saved).

**Inbound:** client message → bridge → `POST /messaging/inbound/telegram` →
concierge agent (read-only tools, grounded in their program/activities) → reply
sent back. **Outbound:** the Telegram provider calls `api.telegram.org` directly
(scheduled flows + the Messages panel); set `MESSAGING_PROVIDER=telegram` to make
it the default channel.

Conversational AI is **Telegram-only** by design — the portal is for insight and
program-change requests, not chat.

## Strava

Browser-side OAuth; only the code-for-token exchange runs server-side. All token
refreshes go through `web/lib/strava-access.ts` (`getStravaAccess`), which:

- persists Strava's **rotated** refresh token on every refresh,
- adopts a token another caller rotated concurrently instead of forcing a reconnect,
- returns `not_connected` (412) / `reconnect_required` (409) rather than a bare 500.

The webhook also handles athlete **deauthorization** (clears the link) and answers
200 on handled failures so Strava doesn't replay them. An `Application / Inactive`
403 means the app is disabled in the Strava developer dashboard — not a code or
token problem. The app secret is UI-managed at `/api-keys` (env fallback).

## LLM model selection

One model is chosen globally in the dashboard header (cookie `llm_model`) and used by every AI feature. The AI service's catalog (`ai/config.py` → `SUPPORTED_LLMS`) is routed via litellm:

| Model id                              | Provider  | Notes |
|---------------------------------------|-----------|-------|
| `gemini/gemma-4-31b-it` *(default)*   | Google    | Free tier — needs only a free `GEMINI_API_KEY` |
| `openai/gpt-4o-mini`, `gpt-4o`, `gpt-4.1-mini` | OpenAI | Bring your own key |
| `anthropic/claude-haiku-4-5-20251001` | Anthropic | Fast, cheap; the one-click paid fallback |
| `anthropic/claude-sonnet-5`           | Anthropic | Balanced |
| `anthropic/claude-opus-5`             | Anthropic | Recommended |
| `anthropic/claude-fable-5`            | Anthropic | Most capable |

Default precedence: `LLM_MODEL` env → Gemma (if `GEMINI_API_KEY`) → Haiku (if `ANTHROPIC_API_KEY`) → `gpt-4o-mini` (if `OPENAI_API_KEY`). Paid models are enabled once the trainer's key is set at `/api-keys` or in env.

InBody OCR calls the Anthropic SDK directly (`INBODY_OCR_MODEL`, default Haiku 4.5). Embeddings always use OpenAI `text-embedding-3-small`.

## CrewAI agents

Defined in `ai/crew/agents.py`. Each agent's read tools are gated by the trainer's per-client data-source toggles (`clients.agent_source_prefs`, `gate_tools`), and every output-producing agent can use client memory RAG, the knowledge base, and web search, citing its sources.

1. **Onboarding** — first-signup intake, writes structured profile + seed memory
2. **Planner** — weekly programme from profile + recent performance; screening-aware test design + safety gating
3. **Nutrition** — personalised markdown food advice using Open Food Facts, cross-referencing training load and body composition
4. **Progress** — trend analysis, plateau & overtraining flags, AFT level classification, HR health
5. **Messaging** — daily reminders / weekly check-ins / post-session nudges via Telegram (cron + scheduled agents)
6. **Concierge** — read-only; answers inbound Telegram messages and powers the portal Insight Tree
7. **Exercise coach** — exercise coaching and research on the Programme page

## Design Reference

Dashboard visual contract: `Dashboard.html` from the Claude Design handoff bundle.
Dark-grey "deep space" base (`#15161a`) with twinkling `<SpaceBackground />` + Apple liquid-glass cards.
