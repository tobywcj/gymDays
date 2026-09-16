-- ============================================================================
-- Per-trainer "not recommended" overlay on the global exercise catalog.
--
-- We never delete or mutate exercise_db rows (it is shared reference data).
-- Instead a trainer can flag an exercise as not-recommended; that exercise drops
-- out of their Programme grid into a collapsed section, the planner skips it for
-- that trainer's clients, and the client portal hides it. Fully reversible.
-- ============================================================================

create table if not exists trainer_exercise_flags (
  trainer_id  uuid not null references trainers(id)   on delete cascade,
  exercise_id uuid not null references exercise_db(id) on delete cascade,
  status      text not null default 'not_recommended',  -- room for future statuses
  note        text,
  created_at  timestamptz not null default now(),
  primary key (trainer_id, exercise_id)
);

create index if not exists idx_trainer_exercise_flags_trainer on trainer_exercise_flags(trainer_id);

alter table trainer_exercise_flags enable row level security;

-- Trainer owns their own flags (read + write).
drop policy if exists trainer_exercise_flags_owner on trainer_exercise_flags;
create policy trainer_exercise_flags_owner on trainer_exercise_flags
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

-- Client-self read: a signed-in client may read the flags of the trainer(s)
-- they train under, so the portal can hide not-recommended exercises.
drop policy if exists trainer_exercise_flags_client_read on trainer_exercise_flags;
create policy trainer_exercise_flags_client_read on trainer_exercise_flags
  for select to authenticated
  using (trainer_id in (select trainer_id from clients where auth_user_id = auth.uid()));
