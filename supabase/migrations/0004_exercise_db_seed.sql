-- ============================================================================
-- M7 — Seed the exercise catalog the Planner Agent draws from.
-- Idempotent: re-runs upsert by name.
-- ============================================================================

insert into exercise_db (name, muscle_group, equipment, difficulty, cues) values
  -- ── Lower body ──
  ('Back Squat',           'legs',   'barbell',    3, 'Brace, drive knees out, hips back'),
  ('Front Squat',          'legs',   'barbell',    4, 'Elbows high, upright torso'),
  ('Romanian Deadlift',    'posterior','barbell',  3, 'Hinge at hips, soft knees, neutral spine'),
  ('Conventional Deadlift','posterior','barbell',  4, 'Pull slack out, push floor away'),
  ('Bulgarian Split Squat','legs',   'dumbbell',   3, 'Rear foot elevated, front-leg focus'),
  ('Walking Lunge',        'legs',   'dumbbell',   2, 'Long stride, knee tracks toes'),
  ('Hip Thrust',           'glutes', 'barbell',    2, 'Posterior pelvic tilt at top, squeeze'),
  ('Goblet Squat',         'legs',   'dumbbell',   1, 'Elbows inside knees, chest tall'),
  ('Leg Curl',             'hamstrings','machine', 1, 'Slow eccentric, no hyperextension'),
  ('Calf Raise',           'calves', 'machine',    1, 'Full stretch, pause at top'),
  ('Step-Up',              'legs',   'dumbbell',   2, 'Drive through heel, no push-off back foot'),

  -- ── Upper push ──
  ('Bench Press',          'chest',  'barbell',    3, 'Bar to lower chest, scapulae retracted'),
  ('Incline Dumbbell Press','chest', 'dumbbell',   3, '30–45° bench, neutral wrists'),
  ('Overhead Press',       'shoulders','barbell',  4, 'Bar travels straight, glutes braced'),
  ('Dumbbell Shoulder Press','shoulders','dumbbell',2,'Pin shoulder blades, neutral grip'),
  ('Push-Up',              'chest',  'bodyweight', 1, 'Hollow body, elbows ~45°'),
  ('Dip',                  'chest',  'bodyweight', 3, 'Lean forward for chest, upright for triceps'),
  ('Lateral Raise',        'shoulders','dumbbell', 1, 'Lead with elbows, slight forward lean'),
  ('Triceps Pushdown',     'arms',   'cable',      1, 'Elbows tucked, full extension'),

  -- ── Upper pull ──
  ('Pull-Up',              'back',   'bodyweight', 4, 'Chin over bar, full hang stretch'),
  ('Chin-Up',              'back',   'bodyweight', 3, 'Supinated grip, biceps assist'),
  ('Lat Pulldown',         'back',   'cable',      1, 'Lean slightly back, drive elbows down'),
  ('Barbell Row',          'back',   'barbell',    3, 'Hip hinge ~45°, drive elbows back'),
  ('Dumbbell Row',         'back',   'dumbbell',   2, 'Brace on bench, pull to hip'),
  ('Face Pull',            'rear-delts','cable',   1, 'Pull to forehead, external rotation'),
  ('Bicep Curl',           'arms',   'dumbbell',   1, 'No swing, full stretch'),

  -- ── Core ──
  ('Plank',                'core',   'bodyweight', 1, 'Glutes tight, ribs tucked'),
  ('Dead Bug',             'core',   'bodyweight', 1, 'Opposite arm + leg, low back flat'),
  ('Hanging Leg Raise',    'core',   'bodyweight', 3, 'No swing, posterior tilt'),
  ('Cable Crunch',         'core',   'cable',      1, 'Round the spine, hips fixed'),
  ('Pallof Press',         'core',   'cable',      1, 'Resist rotation, exhale at full extension'),

  -- ── Conditioning ──
  ('Kettlebell Swing',     'posterior','kettlebell',2, 'Hike pass, hip drive — not a squat'),
  ('Rowing Machine',       'full-body','machine',  1, 'Legs > hips > arms, reverse on return'),
  ('Assault Bike',         'full-body','machine',  2, 'Drive with arms, breathe nasally if possible'),
  ('Sled Push',            'legs',   'machine',    2, 'Low body angle, short choppy steps'),
  ('Jump Rope',            'calves', 'bodyweight', 1, 'Quiet feet, wrists drive the rope')
on conflict (name) do update set
  muscle_group = excluded.muscle_group,
  equipment    = excluded.equipment,
  difficulty   = excluded.difficulty,
  cues         = excluded.cues;
