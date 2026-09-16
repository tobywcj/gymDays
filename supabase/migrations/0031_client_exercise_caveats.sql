-- ============================================================================
-- Per-client, per-exercise suitability caveats (the Programme card badges).
--
-- Computed from the client's injury_history + screening against each exercise.
-- Stored so the trainer's ✅/⚠️/⛔ badges are stable + auditable per client and
-- so agents can reference them. Recomputed (upserted) when a client is selected.
-- ============================================================================

create table if not exists client_exercise_caveats (
  trainer_id  uuid not null references trainers(id)   on delete cascade,
  client_id   uuid not null references clients(id)    on delete cascade,
  exercise_id uuid not null references exercise_db(id) on delete cascade,
  level       text not null default 'ok' check (level in ('ok', 'caution', 'avoid')),
  reasons     jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now(),
  primary key (client_id, exercise_id)
);

create index if not exists idx_client_exercise_caveats_client on client_exercise_caveats(client_id);

alter table client_exercise_caveats enable row level security;

-- Trainer owns caveats for their own clients (read + write).
drop policy if exists client_exercise_caveats_owner on client_exercise_caveats;
create policy client_exercise_caveats_owner on client_exercise_caveats
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

-- Client-self read: a client may read their own caveats on the portal.
drop policy if exists client_exercise_caveats_self_read on client_exercise_caveats;
create policy client_exercise_caveats_self_read on client_exercise_caveats
  for select to authenticated
  using (client_id in (select id from clients where auth_user_id = auth.uid()));
