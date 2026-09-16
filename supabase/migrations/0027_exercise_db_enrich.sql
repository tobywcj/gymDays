-- ============================================================================
-- Enrich exercise_db into the single source of truth for the Programme library.
--
-- The Planner Agent (search_exercise_db / write_program), the per-client program
-- pages, the exercise-coach, and the new Programme UI all read this one table.
-- We ADD nullable columns only — every existing reader keeps working and the
-- original `name / muscle_group / equipment / difficulty / cues` columns + the
-- `muscle_group` vocabulary are untouched (test_planner.py depends on them).
--
-- New rich content (6 key points, progression/regression, variations, target
-- muscle regions, citations) is authored from the AASFP handouts and loaded by
-- 0028_exercise_db_aasfp_seed.sql.
-- ============================================================================

alter table exercise_db
  add column if not exists name_zh           text,
  -- Fine-grained muscle regions for the anatomical chart + display. These are
  -- richer than the scalar `muscle_group` (which stays for planner filtering).
  add column if not exists primary_muscles   text[] not null default '{}',
  add column if not exists secondary_muscles text[] not null default '{}',
  -- Multi-equipment options (cable/band, dumbbell/barbell, …). Scalar
  -- `equipment` remains the primary filter the planner uses.
  add column if not exists equipment_options text[] not null default '{}',
  add column if not exists level             text,  -- beginner | intermediate | advanced
  add column if not exists tempo             text,  -- e.g. '4-4', '3-3'
  -- The AASFP "6 key points": { bodyPosition, stabilization, pathOfMotion,
  -- rangeOfMotion, breathing, rhythm }, each { en, zh }.
  add column if not exists key_points        jsonb,
  add column if not exists progression       jsonb,  -- { en, zh }
  add column if not exists regression        jsonb,  -- { en, zh }
  add column if not exists common_faults     jsonb not null default '[]'::jsonb,  -- [{ en, zh }]
  -- APTHK04 variations: [{ name:{en,zh}, level, equipment:[], note:{en,zh} }]
  add column if not exists variations        jsonb not null default '[]'::jsonb,
  add column if not exists citation          jsonb,  -- { doc, page }
  add column if not exists source            text not null default 'core'; -- 'core' | 'aasfp'

-- Optional level filter speed-up for the coach / library.
create index if not exists idx_exercise_db_level on exercise_db(level);

-- RLS unchanged: exercise_db_read (select to authenticated using true) from
-- 0001_init.sql still applies; writes remain service-role only.
