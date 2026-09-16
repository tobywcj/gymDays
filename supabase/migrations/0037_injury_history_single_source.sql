-- ============================================================================
-- Single source of truth for client injury history = clients.injury_history.
--
-- Two intake paths used to store injuries in two places:
--   • transcript onboarding agent  → clients.injury_history (free text)
--   • screening questionnaire      → client_screenings.medical_history.previous_injuries
-- so questionnaire-onboarded clients had a null injury_history, and readers that
-- only looked at the column (AI get_client_profile, /api/client/[id]/health)
-- silently missed their injuries.
--
-- Fix: clients.injury_history is now the ONE canonical field everything reads.
-- A trigger mirrors every screening write (previous_injuries + notes + PAR-Q
-- free text) into it, and we backfill existing clients. The transcript agent
-- keeps writing the column directly for clients with no screening.
-- ============================================================================

create or replace function sync_client_injury_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  injuries text;
  note     text;
  parq_txt text;
begin
  select string_agg(elem, '; ')
    into injuries
    from jsonb_array_elements_text(coalesce(new.medical_history -> 'previous_injuries', '[]'::jsonb)) as elem
    where length(trim(elem)) > 0;

  note     := nullif(trim(coalesce(new.medical_history ->> 'notes', '')), '');
  parq_txt := nullif(trim(coalesce(new.parq ->> 'free_text', '')), '');

  update clients
     set injury_history = nullif(concat_ws('; ', injuries, note, parq_txt), '')
   where id = new.client_id;

  return new;
end;
$$;

drop trigger if exists trg_sync_injury_history on client_screenings;
create trigger trg_sync_injury_history
  after insert or update on client_screenings
  for each row execute function sync_client_injury_history();

-- Backfill from each client's latest screening, only where the column is empty
-- (so any transcript-onboarded free text isn't clobbered).
with latest as (
  select distinct on (client_id) client_id, medical_history, parq
  from client_screenings
  order by client_id, updated_at desc
)
update clients c
   set injury_history = nullif(concat_ws('; ',
         (select string_agg(elem, '; ')
            from jsonb_array_elements_text(coalesce(l.medical_history -> 'previous_injuries', '[]'::jsonb)) as elem
           where length(trim(elem)) > 0),
         nullif(trim(coalesce(l.medical_history ->> 'notes', '')), ''),
         nullif(trim(coalesce(l.parq ->> 'free_text', '')), '')
       ), '')
  from latest l
 where c.id = l.client_id
   and (c.injury_history is null or c.injury_history = '');
