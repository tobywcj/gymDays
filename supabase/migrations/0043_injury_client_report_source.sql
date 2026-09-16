-- ============================================================================
-- Dedicated source for a client's PORTAL self-report, distinct from the intake
-- 'screening' questionnaire. Both still flag (the caveat + LLM aggregation
-- includes every non-resolved entry regardless of source) — this is purely so
-- the trail tags "Client report" (portal) separately from "Questionnaire".
-- ============================================================================

alter table client_injury_log drop constraint if exists client_injury_log_source_check;
alter table client_injury_log add constraint client_injury_log_source_check
  check (source in ('trainer', 'screening', 'onboarding', 'client_report'));

-- Portal self-reports now use source = 'client_report'.
drop policy if exists injury_log_client_insert on client_injury_log;
create policy injury_log_client_insert on client_injury_log
  for insert to authenticated
  with check (
    source = 'client_report'
    and trainer_id is null
    and resolved_at is null
    and client_id in (select id from clients where auth_user_id = auth.uid())
  );
