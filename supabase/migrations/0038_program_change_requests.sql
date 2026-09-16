-- ============================================================================
-- Client → trainer program-change requests.
--
-- The portal stays read-only EXCEPT for this one narrow path: a client can ask
-- their trainer to change their programme. The trainer reviews + approves /
-- declines on the dashboard. Structured status (not a chat message) so pending
-- requests can be badged and resolved.
-- ============================================================================

create table if not exists program_change_requests (
  id           uuid primary key default gen_random_uuid(),
  trainer_id   uuid not null references trainers(id) on delete cascade,
  client_id    uuid not null references clients(id)  on delete cascade,
  body         text not null,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  trainer_note text,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

create index if not exists idx_pcr_trainer_status on program_change_requests(trainer_id, status);
create index if not exists idx_pcr_client on program_change_requests(client_id);

alter table program_change_requests enable row level security;

-- Trainer owns requests addressed to them: read + update (approve/decline).
drop policy if exists program_change_requests_owner on program_change_requests;
create policy program_change_requests_owner on program_change_requests
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

-- Client may read their own requests on the portal.
drop policy if exists program_change_requests_self_read on program_change_requests;
create policy program_change_requests_self_read on program_change_requests
  for select to authenticated
  using (client_id in (select id from clients where auth_user_id = auth.uid()));

-- Client may file a request for themselves. The trainer_id must match the
-- client's real trainer so a client can't address an arbitrary trainer.
drop policy if exists program_change_requests_self_insert on program_change_requests;
create policy program_change_requests_self_insert on program_change_requests
  for insert to authenticated
  with check (
    client_id in (select id from clients where auth_user_id = auth.uid())
    and trainer_id = (select trainer_id from clients where id = client_id)
  );
