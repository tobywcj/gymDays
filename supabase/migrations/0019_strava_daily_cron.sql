-- Daily incremental Strava sync at midnight UTC.
-- Detects new activities for all connected clients since their last pull.
--
-- Requires two app_config rows:
--   app_url    → your Next.js deployment URL (e.g. https://your-app.vercel.app)
--   cron_secret → matches CRON_SECRET env var in Next.js
--
-- Insert/update them if they don't exist yet:
insert into app_config(key, value) values
  ('app_url',     'http://host.docker.internal:3000'),
  ('cron_secret', 'dev-secret')
on conflict (key) do nothing;

select cron.schedule(
  'gymdays-strava-daily-sync',
  '0 0 * * *',
  $$
  select net.http_post(
    url     := (select value from app_config where key = 'app_url') || '/api/strava/daily-sync-all',
    headers := json_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from app_config where key = 'cron_secret')
    )::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
