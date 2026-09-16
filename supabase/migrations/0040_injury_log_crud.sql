-- ============================================================================
-- Let trainers correct mistakes: allow UPDATE + DELETE on client_injury_log
-- entries for their own clients (e.g. fix a typo'd injury, remove a wrong row).
--
-- The trail is no longer strictly append-only — but it stays trainer-scoped:
-- clients still have read-only access (no write/update/delete policy for them).
-- The canonical clients.injury_history is recomputed by the API after each edit
-- (latest 'trainer' entry, else latest entry) so it always reflects the trail.
-- ============================================================================

drop policy if exists injury_log_trainer_update on client_injury_log;
create policy injury_log_trainer_update on client_injury_log
  for update to authenticated
  using (client_id in (select id from clients where trainer_id = auth.uid()))
  with check (client_id in (select id from clients where trainer_id = auth.uid()));

drop policy if exists injury_log_trainer_delete on client_injury_log;
create policy injury_log_trainer_delete on client_injury_log
  for delete to authenticated
  using (client_id in (select id from clients where trainer_id = auth.uid()));
