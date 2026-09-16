-- ============================================================================
-- Explicit, dated gym sessions built by the trainer in the Programme tab.
--
-- Until now "sessions" were DERIVED from weekly program rows (see
-- web/lib/sessions.ts buildSessions). The session builder lets a trainer
-- organise selected exercises into a session on a specific date for a client.
-- Both the trainer's SessionCalendar and the client's portal calendar read this
-- table — the shared row + RLS IS the trainer→client sync.
-- ============================================================================

create table if not exists sessions (
  id           uuid primary key default gen_random_uuid(),
  trainer_id   uuid not null references trainers(id) on delete cascade,
  client_id    uuid not null references clients(id)  on delete cascade,
  scheduled_at timestamptz not null,
  duration_min int,
  title        text,
  focus        text,
  -- [{ exercise_id, sets, reps, notes, order }]
  exercises    jsonb not null default '[]'::jsonb,
  status       text not null default 'scheduled'
    check (status in ('scheduled', 'done', 'cancelled')),
  created_at   timestamptz not null default now()
);

create index if not exists idx_sessions_trainer on sessions(trainer_id, scheduled_at);
create index if not exists idx_sessions_client  on sessions(client_id, scheduled_at);

alter table sessions enable row level security;

-- Trainer owns their sessions (read + write).
drop policy if exists sessions_owner on sessions;
create policy sessions_owner on sessions
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

-- Client-self read: the signed-in client sees their own sessions (portal is
-- read-only — no client INSERT/UPDATE/DELETE policy).
drop policy if exists sessions_client_read on sessions;
create policy sessions_client_read on sessions
  for select to authenticated
  using (client_id in (select id from clients where auth_user_id = auth.uid()));

-- Live updates on the client portal calendar when the trainer schedules/edits.
-- Guarded: the supabase_realtime publication only exists on Supabase (not on a
-- plain local Postgres), so skip gracefully if it isn't present.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table sessions;
  end if;
end $$;
