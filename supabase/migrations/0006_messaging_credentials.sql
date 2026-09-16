-- ============================================================================
-- Per-trainer messaging-provider credentials.
--
-- Replaces the "set env vars and restart" workflow with a UI-driven Connect
-- flow. Credentials live in the DB, scoped to a single trainer via RLS so
-- one trainer cannot read another's Twilio/Meta tokens.
--
-- The provider factory prefers DB creds (when looking up for a known
-- client_id) and falls back to env vars for system/cron paths.
-- ============================================================================

create table if not exists messaging_credentials (
  id          uuid primary key default gen_random_uuid(),
  trainer_id  uuid not null references trainers(id) on delete cascade,
  provider    text not null,        -- 'twilio-whatsapp' | 'meta-whatsapp' | 'telegram' | 'email'
  credentials jsonb not null,       -- per-provider blob; see ai/messaging/factory.py
  status      text not null default 'connected',
  last_tested_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (trainer_id, provider)
);
create index if not exists idx_messaging_creds_trainer on messaging_credentials(trainer_id);

alter table messaging_credentials enable row level security;
drop policy if exists messaging_creds_owner on messaging_credentials;
create policy messaging_creds_owner on messaging_credentials
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());
