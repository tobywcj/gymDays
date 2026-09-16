# Gym Days

AI-powered client management webapp for personal trainers — CrewAI 5-agent crew, Strava ingestion, multi-channel messaging, per-client AI memory, clinical pre-training screening, and a trainer knowledge base (RAG).

## Setup

All code runs inside the `gymDays` conda env.

```bash
source env.sh                 # activates conda + fixes PATH so node 20 wins over nvm

# Web (dashboard)
cd web && npm install && npm run dev
```

### Database

The cloud Supabase project is the source of truth. Local Postgres remains available for offline iteration.

```bash
# Cloud (source of truth) — needs .env populated (see .env.example)
set -a && source .env && set +a
supabase/run-tests.sh --cloud

# Local (optional; faster iteration)
pg_ctl -D .pgdata -l .pgdata/server.log -o "-p 54329 -k /tmp" start
supabase/run-tests.sh
```

## Milestone Status

| #   | Feature                              | Status | Test                                  |
|-----|--------------------------------------|--------|---------------------------------------|
| M0  | Repo skeleton                        | ✅      | `npm run dev` boots                   |
| M1  | Dashboard visual port                | ✅      | `web/tests/dashboard.spec.ts` (8/8)   |
| M2  | Supabase schema + RLS                | ✅      | `supabase/tests/rls.sql` (4/4 cloud + local) |
| M3  | Trainer auth + live client list      | ✅      | `web/tests/auth.spec.ts` (4/4) + dashboard.spec.ts (8/8) |
| M4  | Client creation + onboarding intake  | ✅      | `web/tests/onboarding.spec.ts` (2/2)  |
| M5  | Onboarding Agent (1/5)               | ✅      | `ai/tests/test_onboarding.py` (6/6)   |
| M6  | Strava OAuth + activity pull         | ✅      | `web/tests/strava.spec.ts` (3/3)      |
| M7  | Planner Agent (2/5)                  | ✅      | `ai/tests/test_planner.py` (6/6)      |
| M8  | Nutrition Agent (3/5)                | ✅      | `ai/tests/test_nutrition.py` (5/5)    |
| M9  | Progress Agent (4/5) + flags         | ✅      | `ai/tests/test_progress.py` (5/5) + `web/tests/progress.spec.ts` (2/2) |
| M10 | Messaging abstraction                | ✅      | `ai/tests/test_messaging.py` (11/11)  |
| M11 | Messaging Agent (5/5) + Flows cron   | ✅      | `ai/tests/test_flows.py` (5/5) + `web/tests/flows.spec.ts` (1/1) |
| M12 | Telegram provider (free + official)  | ✅      | `ai/tests/test_messaging.py` Telegram (2/2 mocked HTTP) + `web/tests/connections.spec.ts` |

### Phase 2 — Clinical screening, clearance & knowledge base

| #   | Feature                              | Status | Test                                  |
|-----|--------------------------------------|--------|---------------------------------------|
| M13 | Screening + assessment schema (PAR-Q, CVD risk, clearance) | ✅ | `supabase/tests/screening_rls.sql` |
| M14 | Trainer invite UX + Telegram delivery | ✅      | `web/tests/connections.spec.ts`       |
| M15 | Public multi-step screening questionnaire + account creation | ✅ | `web/tests/screening_questionnaire.spec.ts` |
| M16 | Trainer realtime notification + auto-filled client view | ✅ | `supabase/migrations/0016_client_screenings.sql` (realtime) |
| M17 | First-lesson assessment capture (in-person) | ✅ | `web/tests/screening_questionnaire.spec.ts` |
| M18 | Planner agent: screening-aware test design + program gating | ✅ | `ai/tests/test_planner_screening.py` |
| KB  | Trainer knowledge base (RAG over uploaded docs) | ✅ | `/knowledge` UI + `ai/knowledge.py` |

Rule: every closed milestone flips its row to ✅ and links the passing test output.

## Architecture

- **web/** — Next.js 15 (App Router) + TypeScript + Tailwind. Trainer dashboard, client onboarding/screening flow, `/connections`, and `/knowledge` (RAG document manager).
- **ai/** — Python FastAPI + CrewAI service (5-agent crew) + per-client memory embeddings + knowledge-base retrieval (`ai/knowledge.py`).
- **supabase/** — migrations (through `0018`) + edge functions + RLS policies. Clinical screening, clearance, and knowledge-base tables live here.
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

Clients are matched to inbound messages by `telegram_chat_id` (set during the
deep-link `/start` linking step).

> Strava, by contrast, uses a real browser-side OAuth handshake — only the
> code-for-token exchange runs server-side, because the `client_secret` can never
> live in the browser.

## LLM model selection

The agent "brain" is configured via the `LLM_MODEL` env var. Both OpenAI and
Anthropic are supported via litellm — same code, just change the env value.

| Model id (env value)                              | Provider  | When to use                |
|---------------------------------------------------|-----------|----------------------------|
| `openai/gpt-4o-mini`                              | OpenAI    | Cheap + fast (default if only `OPENAI_API_KEY` is set) |
| `openai/gpt-4o`                                   | OpenAI    | Higher quality OpenAI tier |
| `anthropic/claude-haiku-4-5-20251001` *(default)* | Anthropic | Cheap + fast (default when `ANTHROPIC_API_KEY` is set) |
| `anthropic/claude-sonnet-4-6`                     | Anthropic | Recommended balance        |
| `anthropic/claude-opus-4-7`                       | Anthropic | Highest quality            |

If neither key is set, calls fail with a clear error. Precedence: `LLM_MODEL` env
var → Anthropic Haiku (if `ANTHROPIC_API_KEY`) → OpenAI `gpt-4o-mini` (if
`OPENAI_API_KEY`).

Embeddings (for per-client memory similarity search) always use OpenAI's
`text-embedding-3-small` — Anthropic has no first-party embedding model.

## CrewAI Agents

All five agents are live (`ai/crew/agents.py`):

1. **Onboarding** — first-signup intake, writes structured profile + seed memory
2. **Planner** — weekly workout plan from profile + recent performance; screening-aware test design + safety gating (`ai/tests/test_planner_screening.py`)
3. **Nutrition** — macros + meal plans using Open Food Facts, cross-references Planner load
4. **Progress** — trend analysis, plateau & overtraining flags
5. **Messaging** — scheduled check-ins / nudges / reminders via Telegram / email (cron-triggered Flows)

A read-only **concierge** path also handles inbound client messages, grounded in
their program/activities and the trainer knowledge base.

## Design Reference

Dashboard visual contract: `Dashboard.html` from the Claude Design handoff bundle.
Earth-tone moss/ochre/terracotta/sage backdrop + Apple liquid-glass cards.
