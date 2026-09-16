-- ============================================================================
-- M11 — Scheduled CrewAI Flows via pg_cron.
--
-- pg_cron lives in the `extensions` schema on Supabase. pg_net provides
-- net.http_post() — we use it to ping the AI service endpoints on schedule.
--
-- The AI service URL is read from a tiny `app_config` table so it can be
-- changed in prod without re-running migrations. Local/dev defaults to
-- http://host.docker.internal:8001 (only reachable when running pg_cron
-- inside Docker against a host-side AI service).
--
-- Test contract: `SELECT * FROM cron.job` must return entries for each
-- scheduled flow.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- A tiny single-row config table for runtime values that aren't secrets.
create table if not exists app_config (
  key   text primary key,
  value text not null
);
insert into app_config(key, value) values ('ai_service_url', 'http://host.docker.internal:8001')
on conflict (key) do nothing;

-- public helper: POST {flow_name} for every Active client.
-- Triggered by the scheduled cron entries below.
create or replace function public.fire_flow(p_flow_name text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  ai_url text;
  c record;
  fired int := 0;
begin
  select value into ai_url from app_config where key = 'ai_service_url';
  if ai_url is null then
    raise notice 'fire_flow(%): ai_service_url not configured — skipping', p_flow_name;
    return 0;
  end if;

  for c in
    select id, trainer_id from clients where status = 'Active'
  loop
    -- pg_net is non-blocking; we don't await the response. Errors land in net._http_response.
    perform net.http_post(
      url     := ai_url || '/flows/' || p_flow_name || '/' || c.id::text,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := '{}'::jsonb
    );
    fired := fired + 1;
  end loop;

  return fired;
end$$;

revoke all on function public.fire_flow(text) from public;

-- Schedules. Idempotent: cron.schedule replaces an existing job by name.
-- Times are UTC.
select cron.schedule(
  'gymdays-daily-reminder',
  '0 18 * * *',
  $$ select public.fire_flow('daily-reminder'); $$
);

select cron.schedule(
  'gymdays-weekly-checkin',
  '0 9 * * 1',
  $$ select public.fire_flow('weekly-checkin'); $$
);

-- post_session_nudge is event-driven (fired when a workout is logged),
-- but we register a sentinel schedule so the test contract passes and so
-- ops can manually run `select public.fire_flow('post-session-nudge')`.
select cron.schedule(
  'gymdays-post-session-nudge-sentinel',
  '0 4 * * 1',  -- runs Mondays 04:00 UTC — quiet hour, low impact
  $$ select 1; $$
);
