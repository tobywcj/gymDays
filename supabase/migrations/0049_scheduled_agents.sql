-- ============================================================================
-- Scheduled agent activities (trainer-defined cron jobs).
--
-- Replaces the read-only "Agent Activity" feed on the dashboard with a way for
-- a trainer to schedule an agent task (a messaging flow) to run automatically
-- for some or all of their clients, sending a Telegram message each time.
--
-- Execution model: a single pg_cron job ("gymdays-agent-dispatch") fires every
-- 5 minutes and POSTs to /api/agents/scheduled/dispatch. That endpoint finds
-- every enabled schedule whose next_run_at is due, runs the chosen flow for
-- each target client (which drafts + sends a Telegram message), then advances
-- next_run_at. Storing next_run_at — rather than a raw cron string — keeps the
-- due-check trivial and prevents double-fires between dispatch ticks.
-- ============================================================================

create table if not exists scheduled_agents (
  id          uuid primary key default gen_random_uuid(),
  trainer_id  uuid not null references trainers(id) on delete cascade,
  name        text not null,
  -- Which messaging flow the agent runs. These are the flows that draft and
  -- send a Telegram message (see ai/crew/flows.py).
  flow        text not null check (flow in ('daily-reminder', 'weekly-checkin', 'post-session-nudge')),
  -- Target selection: either every Active client, or an explicit list.
  target_all  boolean not null default false,
  client_ids  uuid[] not null default '{}',
  -- Schedule, interpreted in the trainer's local time. tz_offset_minutes is the
  -- browser getTimezoneOffset() captured at save time (UTC = local + offset).
  frequency         text not null check (frequency in ('daily', 'weekly')),
  hour              int  not null default 9 check (hour between 0 and 23),
  minute            int  not null default 0 check (minute between 0 and 59),
  weekday           int  check (weekday between 0 and 6),  -- 0=Sun .. 6=Sat, weekly only
  tz_offset_minutes int  not null default 0,
  enabled     boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_scheduled_agents_trainer on scheduled_agents(trainer_id);
create index if not exists idx_scheduled_agents_due on scheduled_agents(next_run_at) where enabled;

alter table scheduled_agents enable row level security;

-- A trainer owns (and only sees) their own schedules.
drop policy if exists scheduled_agents_owner on scheduled_agents;
create policy scheduled_agents_owner on scheduled_agents
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

-- ── Dispatch cron ───────────────────────────────────────────────────────────
-- Needs app_url + cron_secret in app_config (already seeded by 0019). Runs
-- every 5 minutes; the endpoint itself decides which schedules are due.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'gymdays-agent-dispatch',
      '*/5 * * * *',
      $cron$
      select net.http_post(
        url     := (select value from app_config where key = 'app_url') || '/api/agents/scheduled/dispatch',
        headers := json_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select value from app_config where key = 'cron_secret')
        )::jsonb,
        body    := '{}'::jsonb
      );
      $cron$
    );
  end if;
end$$;
