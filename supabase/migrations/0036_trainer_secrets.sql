-- ============================================================================
-- Per-trainer secret keys (bring-your-own API keys).
--
-- Lets each trainer store their own provider/API secrets (e.g. Anthropic,
-- OpenAI, Strava) so usage + cost lands on their own account rather than the
-- platform's shared keys. Free-form key/value so trainers can add ANY secret.
--
-- RLS-scoped: a trainer can only ever read/write their own rows.
-- ============================================================================

create table if not exists trainer_secrets (
  id          uuid primary key default gen_random_uuid(),
  trainer_id  uuid not null references trainers(id) on delete cascade,
  key         text not null,        -- e.g. 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'
  value       text not null,        -- the secret itself
  label       text,                 -- optional human-friendly note
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (trainer_id, key)
);
create index if not exists idx_trainer_secrets_trainer on trainer_secrets(trainer_id);

alter table trainer_secrets enable row level security;
drop policy if exists trainer_secrets_owner on trainer_secrets;
create policy trainer_secrets_owner on trainer_secrets
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());
