-- ============================================================================
-- Trainer-managed injury history with an append-only audit trail.
--
-- Change of model: the screening questionnaire is now the client's SELF-REPORT
-- (a reference), and the trainer owns the official injury status. Rules:
--   • Only the trainer updates clients.injury_history (via the pre-screening card).
--   • Every change is appended to client_injury_log — an immutable trail
--     (no UPDATE/DELETE policy). Trainer entries are 'trainer'; the questionnaire
--     contributes 'screening' entries.
--   • NO OVERRIDE: a screening write seeds clients.injury_history only when it's
--     still empty; once anything is set it is never overwritten by the screening.
-- ============================================================================

create table if not exists client_injury_log (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  trainer_id  uuid references trainers(id) on delete set null,  -- null for screening/system entries
  source      text not null check (source in ('trainer', 'screening', 'onboarding')),
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_injury_log_client on client_injury_log(client_id, created_at desc);

alter table client_injury_log enable row level security;

-- Trainer: read + append for their own clients. Deliberately NO update/delete
-- policy → the trail is immutable (append-only).
drop policy if exists injury_log_trainer_read on client_injury_log;
create policy injury_log_trainer_read on client_injury_log
  for select to authenticated
  using (client_id in (select id from clients where trainer_id = auth.uid()));

drop policy if exists injury_log_trainer_insert on client_injury_log;
create policy injury_log_trainer_insert on client_injury_log
  for insert to authenticated
  with check (
    trainer_id = auth.uid()
    and client_id in (select id from clients where trainer_id = auth.uid())
  );

-- Client self-read (portal can show their own trail). No write.
drop policy if exists injury_log_client_read on client_injury_log;
create policy injury_log_client_read on client_injury_log
  for select to authenticated
  using (client_id in (select id from clients where auth_user_id = auth.uid()));

-- Replace the sync function: log the self-report + seed only when empty (no override).
create or replace function sync_client_injury_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  combined  text;
  last_note text;
begin
  combined := nullif(concat_ws('; ',
    (select string_agg(elem, '; ')
       from jsonb_array_elements_text(coalesce(new.medical_history -> 'previous_injuries', '[]'::jsonb)) as elem
      where length(trim(elem)) > 0),
    nullif(trim(coalesce(new.medical_history ->> 'notes', '')), ''),
    nullif(trim(coalesce(new.parq ->> 'free_text', '')), '')
  ), '');

  -- Record the client's self-report in the trail (only when it actually changed).
  if combined is not null then
    select note into last_note
      from client_injury_log
     where client_id = new.client_id and source = 'screening'
     order by created_at desc limit 1;
    if combined is distinct from last_note then
      insert into client_injury_log (client_id, trainer_id, source, note)
      values (new.client_id, null, 'screening', combined);
    end if;
  end if;

  -- Seed the canonical status ONLY when the trainer hasn't set one yet.
  update clients
     set injury_history = combined
   where id = new.client_id
     and (injury_history is null or injury_history = '');

  return new;
end;
$$;

-- Seed the trail with each client's current injury_history so history starts populated.
insert into client_injury_log (client_id, trainer_id, source, note)
select c.id, null, 'screening', c.injury_history
from clients c
where c.injury_history is not null and c.injury_history <> ''
  and not exists (select 1 from client_injury_log l where l.client_id = c.id);
