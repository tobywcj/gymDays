-- ============================================================================
-- Drop the post-session-nudge cron sentinel.
--
-- 0005_pg_cron_jobs.sql registered `gymdays-post-session-nudge-sentinel`, a
-- no-op `select 1;` schedule that existed only to satisfy an old test contract.
-- post_session_nudge is event-driven (fired when a workout is logged), so it
-- never needed a schedule. Remove the no-op so cron.job reflects only the jobs
-- that actually do work.
--
-- Idempotent: cron.unschedule throws if the job is absent, so guard on existence.
-- ============================================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'gymdays-post-session-nudge-sentinel') then
    perform cron.unschedule('gymdays-post-session-nudge-sentinel');
  end if;
end $$;
