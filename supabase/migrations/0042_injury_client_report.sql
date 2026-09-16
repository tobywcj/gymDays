-- ============================================================================
-- Let a CLIENT report a new injury from their portal. They may only INSERT a
-- self-report ('screening', trainer_id null) for their own client_id — they
-- cannot create trainer entries, edit, delete, or resolve (trainer authority is
-- preserved). The report shows in the trail + flags via the caveat aggregation;
-- the trainer confirms it into the official status.
-- ============================================================================

drop policy if exists injury_log_client_insert on client_injury_log;
create policy injury_log_client_insert on client_injury_log
  for insert to authenticated
  with check (
    source = 'screening'
    and trainer_id is null
    and resolved_at is null
    and client_id in (select id from clients where auth_user_id = auth.uid())
  );
