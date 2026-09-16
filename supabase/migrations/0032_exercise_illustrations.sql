-- ============================================================================
-- AI-generated exercise illustrations.
--
-- Adds a nullable `illustration_url` to exercise_db: a stylised anatomical
-- illustration of the movement with the target muscles highlighted, generated
-- per exercise by scripts/gen-exercise-illustrations.mjs (OpenAI image model)
-- and stored in the public `exercise-illustrations` storage bucket.
--
-- The Programme cards prefer this illustration as the primary visual and fall
-- back to the interactive MuscleMap when it's null. Additive + nullable, so
-- every existing reader keeps working.
-- ============================================================================

alter table exercise_db
  add column if not exists illustration_url text;

-- Public, read-only bucket for the generated illustrations. Guarded so this is
-- a no-op on a plain local Postgres that has no storage schema.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public)
    values ('exercise-illustrations', 'exercise-illustrations', true)
    on conflict (id) do nothing;
  end if;
end $$;
