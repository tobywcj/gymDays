-- ============================================================================
-- Gym Days — Initial schema + RLS (M2)
-- Targets: real Supabase project (postgres + supabase_auth) AND local Postgres
-- with the auth-shim block at the top. The shim is a no-op on real Supabase
-- because the auth schema already exists.
-- ============================================================================

-- ─── Extensions ─────────────────────────────────────────────────────────────
-- gen_random_uuid() is built-in since PG13. pgcrypto only needed for older PG
-- or for digest()/encrypt() helpers we don't currently use.
create extension if not exists vector;
-- pg_cron is loaded via shared_preload_libraries on Supabase; skip locally.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
  end if;
end$$;

-- ─── Auth shim (no-op on real Supabase) ─────────────────────────────────────
-- Supabase provides auth.uid() and auth.jwt() natively. On a plain Postgres
-- (local) we install equivalent functions backed by request.jwt.claims so the
-- exact same RLS policies work in both environments.
do $$
declare
  has_auth_uid boolean;
begin
  create schema if not exists auth;
  select exists(
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) into has_auth_uid;

  if not has_auth_uid then
    execute $f$
      create function auth.jwt() returns jsonb language sql stable as $body$
        select coalesce(
          nullif(current_setting('request.jwt.claims', true), '')::jsonb,
          '{}'::jsonb
        )
      $body$;
    $f$;
    execute $f$
      create function auth.uid() returns uuid language sql stable as $body$
        select nullif(auth.jwt() ->> 'sub', '')::uuid
      $body$;
    $f$;
  end if;
end$$;

-- Roles Supabase uses (idempotent locally; already present on real Supabase).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
end$$;

-- ─── Tables ─────────────────────────────────────────────────────────────────

create table if not exists trainers (
  id uuid primary key,
  email text not null unique,
  full_name text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$ begin
  create type client_status as enum ('Active', 'Resting', 'Flagged');
exception when duplicate_object then null; end $$;

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  goal text,
  equipment jsonb not null default '[]'::jsonb,
  schedule jsonb not null default '{}'::jsonb,
  injury_history text,
  profile jsonb not null default '{}'::jsonb,
  strava_athlete_id text,
  preferred_channel text,
  status client_status not null default 'Active',
  created_at timestamptz not null default now()
);
create index if not exists idx_clients_trainer on clients(trainer_id);

create table if not exists programs (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  week_start date not null,
  plan jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_programs_client on programs(client_id, week_start desc);

create table if not exists meal_plans (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  program_id uuid references programs(id) on delete set null,
  week_start date not null,
  plan jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_meal_plans_client on meal_plans(client_id, week_start desc);

create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  performed_at timestamptz not null,
  rpe smallint,
  notes text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_workouts_client on workouts(client_id, performed_at desc);

create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  source text not null default 'strava',
  external_id text not null,
  started_at timestamptz not null,
  type text,
  distance_m numeric,
  duration_s integer,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(source, external_id)
);
create index if not exists idx_activities_client on activities(client_id, started_at desc);

create table if not exists messaging_threads (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  channel text not null,
  external_handle text,
  created_at timestamptz not null default now(),
  unique(client_id, channel)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  thread_id uuid references messaging_threads(id) on delete set null,
  direction text not null check (direction in ('inbound','outbound')),
  channel text not null,
  body text not null,
  status text not null default 'sent',
  sent_at timestamptz not null default now()
);
create index if not exists idx_messages_client on messages(client_id, sent_at desc);

create table if not exists progress_reports (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  summary text,
  flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_reports_client on progress_reports(client_id, period_end desc);

do $$ begin
  create type memory_kind as enum (
    'onboarding_note',
    'preference',
    'constraint',
    'progress_summary',
    'message_log',
    'nutrition_note'
  );
exception when duplicate_object then null; end $$;

create table if not exists client_memory (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  kind memory_kind not null,
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);
create index if not exists idx_client_memory_client on client_memory(client_id, created_at desc);
create index if not exists idx_client_memory_embedding
  on client_memory using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  agent text not null,
  flow text,
  input jsonb,
  output jsonb,
  status text not null default 'completed',
  cost_usd numeric,
  latency_ms integer,
  cite text,
  created_at timestamptz not null default now()
);
create index if not exists idx_agent_runs_trainer on agent_runs(trainer_id, created_at desc);

create table if not exists integration_tokens (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  provider text not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique(client_id, provider)
);

create table if not exists exercise_db (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  muscle_group text,
  equipment text,
  difficulty smallint,
  cues text
);

create table if not exists food_cache (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'openfoodfacts',
  external_id text not null,
  name text not null,
  per_100g jsonb not null,
  fetched_at timestamptz not null default now(),
  unique(source, external_id)
);

-- ─── RLS ────────────────────────────────────────────────────────────────────
alter table trainers           enable row level security;
alter table clients            enable row level security;
alter table programs           enable row level security;
alter table meal_plans         enable row level security;
alter table workouts           enable row level security;
alter table activities         enable row level security;
alter table messaging_threads  enable row level security;
alter table messages           enable row level security;
alter table progress_reports   enable row level security;
alter table client_memory      enable row level security;
alter table agent_runs         enable row level security;
alter table integration_tokens enable row level security;

-- exercise_db and food_cache are global reference data — readable by all
-- authenticated users, writable only by service_role.
alter table exercise_db        enable row level security;
alter table food_cache         enable row level security;

drop policy if exists trainers_self on trainers;
create policy trainers_self on trainers
  for all to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- generic "owned by trainer" policy template applied per-table
drop policy if exists clients_owner            on clients;            create policy clients_owner            on clients            for all to authenticated using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
drop policy if exists programs_owner           on programs;           create policy programs_owner           on programs           for all to authenticated using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
drop policy if exists meal_plans_owner         on meal_plans;         create policy meal_plans_owner         on meal_plans         for all to authenticated using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
drop policy if exists workouts_owner           on workouts;           create policy workouts_owner           on workouts           for all to authenticated using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
drop policy if exists activities_owner         on activities;         create policy activities_owner         on activities         for all to authenticated using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
drop policy if exists messaging_threads_owner  on messaging_threads;  create policy messaging_threads_owner  on messaging_threads  for all to authenticated using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
drop policy if exists messages_owner           on messages;           create policy messages_owner           on messages           for all to authenticated using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
drop policy if exists progress_reports_owner   on progress_reports;   create policy progress_reports_owner   on progress_reports   for all to authenticated using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
drop policy if exists agent_runs_owner         on agent_runs;         create policy agent_runs_owner         on agent_runs         for all to authenticated using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
drop policy if exists integration_tokens_owner on integration_tokens; create policy integration_tokens_owner on integration_tokens for all to authenticated using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());

-- client_memory: dual-scoped. Trainer JWT (no client_id claim) → trainer sees all
-- their clients' memory. Agent JWT (scoped with client_id claim) → strict
-- isolation to that single client. The latter is how the AI service operates.
drop policy if exists client_memory_scoped on client_memory;
create policy client_memory_scoped on client_memory
  for all to authenticated
  using (
    trainer_id = auth.uid()
    and (
      (auth.jwt() ->> 'client_id') is null
      or client_id::text = (auth.jwt() ->> 'client_id')
    )
  )
  with check (
    trainer_id = auth.uid()
    and (
      (auth.jwt() ->> 'client_id') is null
      or client_id::text = (auth.jwt() ->> 'client_id')
    )
  );

-- Global reference tables: read for any authenticated user
drop policy if exists exercise_db_read on exercise_db; create policy exercise_db_read on exercise_db for select to authenticated using (true);
drop policy if exists food_cache_read  on food_cache;  create policy food_cache_read  on food_cache  for select to authenticated using (true);

-- Grants (Supabase grants schema-wide; mirror locally so the role can use the tables)
grant usage on schema public to authenticated, service_role, anon;
-- On real Supabase the auth schema is owned by supabase_auth_admin and these
-- grants will fail. They're only needed for the local Postgres path.
do $$
begin
  begin
    execute 'grant usage on schema auth to authenticated, service_role, anon';
    execute 'grant execute on function auth.uid() to authenticated, service_role, anon';
    execute 'grant execute on function auth.jwt() to authenticated, service_role, anon';
  exception when insufficient_privilege then
    null; -- on Supabase: already granted by the platform, skip silently
  end;
end$$;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
