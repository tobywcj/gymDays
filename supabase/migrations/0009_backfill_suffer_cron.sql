-- ============================================================================
-- M12 — Scheduled Strava suffer_score backfill.
--
-- Strava computes suffer_score asynchronously after a workout is uploaded.
-- The initial webhook fetch often returns null. Every 30 minutes this job
-- calls /strava/backfill-suffer on the AI service, which re-fetches any
-- Strava activities created in the last 6 hours that are still missing it.
-- ============================================================================

select cron.schedule(
  'gymdays-strava-backfill-suffer',
  '*/30 * * * *',
  $$
  select net.http_post(
    url     := (select value from app_config where key = 'ai_service_url') || '/strava/backfill-suffer',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
