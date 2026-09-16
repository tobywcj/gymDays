-- ============================================================================
-- Targeted daily reminder: only fire for clients who have a workout planned
-- for TOMORROW on the trainer's calendar.
--
-- Schedule: 0 10 * * * UTC = 18:00 HKT.
--
-- Checks TWO sources (both rendered on the trainer's SessionCalendar):
--
--   1. `public.sessions` — explicit trainer-scheduled sessions with a
--      `scheduled_at` timestamptz. Queried via dynamic SQL so the function
--      is safe even before the sessions migration is applied.
--
--   2. `programs` — AI-generated weekly plans. Shape:
--      { "days": [{ "day": "Mon", "focus": "...", "exercises": [...] }] }
--      Days are 3-letter weekday abbreviations (Mon/Tue/…) relative to
--      week_start (always a Monday).
--
-- A client in either source gets exactly one reminder.
-- ============================================================================

create or replace function public.fire_daily_reminder()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  ai_url     text;
  tomorrow   date;
  day_abbrev text;
  week_mon   date;
  c          record;
  fired      int := 0;
begin
  select value into ai_url from app_config where key = 'ai_service_url';
  if ai_url is null then
    raise notice 'fire_daily_reminder: ai_service_url not configured — skipping';
    return 0;
  end if;

  tomorrow   := (now() at time zone 'utc')::date + 1;
  day_abbrev := to_char(tomorrow, 'Dy');           -- 'Mon', 'Tue', … 'Sun'
  -- Monday of tomorrow's week (dow: Sun=0 Mon=1 … Sat=6 → days since Mon = (dow+6)%7)
  week_mon   := tomorrow - ((extract(dow from tomorrow)::int + 6) % 7);

  -- Collect client_ids from both sources into a temp table for dedup.
  create temp table _due_clients (client_id uuid) on commit drop;

  -- Source 1: explicit sessions table (dynamic SQL — safe if table absent).
  if to_regclass('public.sessions') is not null then
    execute format(
      $q$
        insert into _due_clients
        select distinct s.client_id
        from public.sessions s
        join public.clients cl on cl.id = s.client_id and cl.status = 'Active'
        where s.scheduled_at::date = %L
      $q$,
      tomorrow
    );
  end if;

  -- Source 2: AI-generated programs — match tomorrow's weekday abbreviation.
  insert into _due_clients
  select distinct p.client_id
  from programs p
  join clients cl on cl.id = p.client_id and cl.status = 'Active'
  where p.week_start = week_mon
    and exists (
      select 1
      from jsonb_array_elements(p.plan -> 'days') d
      where d->>'day' = day_abbrev
    );

  -- Fire one POST per distinct client.
  for c in select distinct client_id from _due_clients loop
    perform net.http_post(
      url     := ai_url || '/flows/daily-reminder/' || c.client_id::text,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := '{}'::jsonb
    );
    fired := fired + 1;
  end loop;

  return fired;
end$$;

revoke all on function public.fire_daily_reminder() from public;

-- 10:00 UTC = 18:00 HKT. cron.schedule replaces by name — idempotent.
select cron.schedule(
  'gymdays-daily-reminder',
  '0 10 * * *',
  $$ select public.fire_daily_reminder(); $$
);
