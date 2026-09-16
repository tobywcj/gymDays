-- Update the suffer_score backfill cron to run hourly and cover all history.
-- cron.schedule replaces an existing job by name.
select cron.schedule(
  'gymdays-strava-backfill-suffer',
  '0 * * * *',
  $$
  select net.http_post(
    url     := (select value from app_config where key = 'ai_service_url') || '/strava/backfill-suffer',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
