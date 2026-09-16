-- ============================================================================
-- Backfill bilingual names + target muscle groups for the original 'core'
-- exercises (0004_exercise_db_seed.sql), which were seeded with only an English
-- name + muscle_group — so their portal cards show no Chinese name and no
-- target-muscle subtitle (the subtitle is built from primary_muscles).
--
-- Idempotent and non-destructive: only fills a column when it is currently
-- empty, so AASFP-enriched rows (0028) of the same name are never clobbered.
-- primary_muscles / secondary_muscles use the MuscleRegion codes the UI maps
-- via MUSCLE_LABELS (web/components/programme/MuscleMap.tsx).
-- ============================================================================

update exercise_db as e set
  name_zh = coalesce(e.name_zh, v.name_zh),
  primary_muscles = case
    when e.primary_muscles is null or cardinality(e.primary_muscles) = 0 then v.primary_muscles
    else e.primary_muscles end,
  secondary_muscles = case
    when e.secondary_muscles is null or cardinality(e.secondary_muscles) = 0 then v.secondary_muscles
    else e.secondary_muscles end
from (values
  -- name, name_zh, primary_muscles, secondary_muscles
  ('Back Squat',             '槓鈴深蹲',       array['quads','glutes']::text[],            array['hamstrings','erectors']::text[]),
  ('Front Squat',            '前蹲',           array['quads','glutes']::text[],            array['erectors','abs']::text[]),
  ('Romanian Deadlift',      '羅馬尼亞硬舉',    array['hamstrings','glutes']::text[],       array['erectors']::text[]),
  ('Conventional Deadlift',  '傳統硬舉',        array['glutes','hamstrings','erectors']::text[], array['quads','traps','lats']::text[]),
  ('Bulgarian Split Squat',  '保加利亞分腿蹲',  array['quads','glutes']::text[],            array['hamstrings']::text[]),
  ('Walking Lunge',          '行走弓步',        array['quads','glutes']::text[],            array['hamstrings']::text[]),
  ('Hip Thrust',             '臀推',           array['glutes']::text[],                    array['hamstrings']::text[]),
  ('Goblet Squat',           '高腳杯深蹲',      array['quads','glutes']::text[],            array['erectors']::text[]),
  ('Leg Curl',               '腿後彎舉',        array['hamstrings']::text[],                array['calves']::text[]),
  ('Calf Raise',             '提踵',           array['calves']::text[],                    array[]::text[]),
  ('Step-Up',                '踏階',           array['quads','glutes']::text[],            array['hamstrings']::text[]),
  ('Bench Press',            '槓鈴臥推',        array['chest','front-delts']::text[],       array['triceps']::text[]),
  ('Incline Dumbbell Press', '上斜啞鈴臥推',    array['chest','front-delts']::text[],       array['triceps']::text[]),
  ('Overhead Press',         '站姿肩上推舉',    array['front-delts','side-delts']::text[],  array['triceps']::text[]),
  ('Dumbbell Shoulder Press','啞鈴肩推',        array['front-delts','side-delts']::text[],  array['triceps']::text[]),
  ('Push-Up',                '掌上壓',          array['chest','front-delts']::text[],       array['triceps']::text[]),
  ('Dip',                    '雙槓臂屈伸',      array['chest','triceps']::text[],           array['front-delts']::text[]),
  ('Lateral Raise',          '啞鈴側平舉',      array['side-delts']::text[],                array['traps']::text[]),
  ('Triceps Pushdown',       '三頭肌下壓',      array['triceps']::text[],                   array[]::text[]),
  ('Pull-Up',                '引體向上',        array['lats']::text[],                      array['biceps','rhomboids']::text[]),
  ('Chin-Up',                '反握引體向上',    array['lats','biceps']::text[],             array['rhomboids']::text[]),
  ('Lat Pulldown',           '滑輪下拉',        array['lats']::text[],                      array['biceps','rhomboids']::text[]),
  ('Barbell Row',            '槓鈴划船',        array['lats','rhomboids']::text[],          array['biceps','traps']::text[]),
  ('Dumbbell Row',           '啞鈴單臂划船',    array['lats','rhomboids']::text[],          array['biceps']::text[]),
  ('Face Pull',              '繩索面拉',        array['rear-delts','traps']::text[],        array['rhomboids']::text[]),
  ('Bicep Curl',             '啞鈴二頭彎舉',    array['biceps']::text[],                    array['forearms']::text[]),
  ('Plank',                  '平板支撐',        array['abs']::text[],                       array['obliques']::text[]),
  ('Dead Bug',               '死蟲式',          array['abs']::text[],                       array[]::text[]),
  ('Hanging Leg Raise',      '懸吊舉腿',        array['abs']::text[],                       array['obliques']::text[]),
  ('Cable Crunch',           '滑輪捲腹',        array['abs']::text[],                       array[]::text[]),
  ('Pallof Press',           '帕洛夫推',        array['obliques','abs']::text[],            array[]::text[]),
  ('Kettlebell Swing',       '壺鈴擺盪',        array['glutes','hamstrings']::text[],       array['erectors']::text[]),
  ('Rowing Machine',         '划船機',          array['lats','quads']::text[],              array['hamstrings','biceps']::text[]),
  ('Assault Bike',           '風阻單車',        array['quads','hamstrings']::text[],        array['calves']::text[]),
  ('Sled Push',              '雪橇推',          array['quads','glutes']::text[],            array['calves']::text[]),
  ('Jump Rope',              '跳繩',            array['calves']::text[],                    array[]::text[])
) as v(name, name_zh, primary_muscles, secondary_muscles)
where e.name = v.name;
