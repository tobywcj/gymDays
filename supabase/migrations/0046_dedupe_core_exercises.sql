-- ============================================================================
-- Remove the legacy source='core' exercise_db rows (0004 seed) that are now
-- duplicated by a richer source='aasfp' equivalent (0028 seed).
--
-- Why duplicates existed: both seeds upsert `on conflict (name)`, but they use
-- different names for the same movement (e.g. 'Bench Press' vs 'Barbell Bench
-- Press'), so the conflict never fired and both rows survived. The Programme
-- library reads every row with no source filter, so the same movement showed
-- twice — once as a bare "core" card, once as the cited AASFP card.
--
-- Only CONFIDENT, same-movement pairs are mapped below. Borderline cases that
-- differ in equipment/stance (e.g. dumbbell 'Lateral Raise' vs 'Cable Lateral
-- Raise', 'Overhead Press' vs 'Seated Barbell Shoulder Press', 'Romanian
-- Deadlift' vs 'Dumbbell Stiff Leg Deadlift') are intentionally KEPT — add a
-- row to the VALUES list to retire more.
--
-- Before deleting each core row we re-point every reference to the AASFP row so
-- nothing dangles: trainer flags, client caveats (both FK cascade), and the
-- exercise_id values embedded in programs.plan / sessions.exercises JSONB.
-- Idempotent: skips any pair already cleaned up.
-- ============================================================================

do $$
declare
  m        record;
  core_id  uuid;
  aasfp_id uuid;
begin
  for m in (
    select * from (values
      ('Bench Press',      'Barbell Bench Press'),
      ('Back Squat',       'Barbell Parallel Squat'),
      ('Hip Thrust',       'Barbell Hip Thrust'),
      ('Barbell Row',      'Barbell Bent Over Row'),
      ('Lat Pulldown',     'Lat Pull Down'),
      ('Bicep Curl',       'Dumbbell Bicep Curl'),
      ('Triceps Pushdown', 'Cable / Band Triceps Press Down')
    ) as t(core_name, aasfp_name)
  ) loop
    select id into core_id  from exercise_db where name = m.core_name  and source = 'core';
    select id into aasfp_id from exercise_db where name = m.aasfp_name and source = 'aasfp';

    -- Already cleaned up, or a name drifted — skip safely.
    if core_id is null or aasfp_id is null then
      continue;
    end if;

    -- 1) trainer_exercise_flags (PK trainer_id,exercise_id): drop rows that would
    --    collide on the AASFP row, then re-point the rest.
    delete from trainer_exercise_flags f
      where f.exercise_id = core_id
        and exists (
          select 1 from trainer_exercise_flags g
          where g.trainer_id = f.trainer_id and g.exercise_id = aasfp_id
        );
    update trainer_exercise_flags set exercise_id = aasfp_id where exercise_id = core_id;

    -- 2) client_exercise_caveats (PK client_id,exercise_id): same de-collide + re-point.
    delete from client_exercise_caveats c
      where c.exercise_id = core_id
        and exists (
          select 1 from client_exercise_caveats d
          where d.client_id = c.client_id and d.exercise_id = aasfp_id
        );
    update client_exercise_caveats set exercise_id = aasfp_id where exercise_id = core_id;

    -- 3) programs.plan — rewrite exercise_id inside days[].exercises[]. UUIDs are
    --    globally unique so a substring swap is safe and avoids nested jsonb surgery.
    update programs
      set plan = replace(plan::text, core_id::text, aasfp_id::text)::jsonb
      where plan::text like '%' || core_id::text || '%';

    -- 4) sessions.exercises — same rewrite.
    update sessions
      set exercises = replace(exercises::text, core_id::text, aasfp_id::text)::jsonb
      where exercises::text like '%' || core_id::text || '%';

    -- 5) Drop the now-redundant core row.
    delete from exercise_db where id = core_id;
  end loop;
end $$;
