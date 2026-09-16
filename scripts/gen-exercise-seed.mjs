// Generates supabase/migrations/0028_exercise_db_aasfp_seed.sql from the typed
// authoring catalog in web/lib/exercise-library.ts.
//
// Usage (from repo root):
//   npx tsc web/lib/exercise-library.ts --outDir /tmp/exlib --module esnext \
//     --target es2020 --moduleResolution node --skipLibCheck
//   node scripts/gen-exercise-seed.mjs /tmp/exlib/exercise-library.js
//
// The DB (exercise_db) is the runtime source of truth; this keeps the rich
// AASFP content type-checked + editable in TS while the migration is mechanical.
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const modPath = process.argv[2] || "/tmp/exlib/exercise-library.js";
const { AASFP_EXERCISES } = await import(pathToFileURL(resolve(modPath)).href);

// Dollar-quote a string body so we never have to escape single quotes.
const dq = (s, tag = "x") => `$${tag}$${s}$${tag}$`;
const txt = (s) => (s == null ? "null" : dq(String(s), "t"));
const json = (v) => `${dq(JSON.stringify(v), "j")}::jsonb`;
const arr = (xs) =>
  `array[${(xs || []).map((x) => dq(String(x), "a")).join(", ")}]::text[]`;

const COLS = [
  "name", "name_zh", "muscle_group", "equipment", "equipment_options", "level",
  "difficulty", "primary_muscles", "secondary_muscles", "cues", "tempo",
  "key_points", "progression", "regression", "common_faults", "variations",
  "citation", "source",
];

function row(e) {
  return `  (${[
    txt(e.name),
    txt(e.nameZh),
    txt(e.muscleGroup),
    txt(e.equipment),
    arr(e.equipmentOptions),
    txt(e.level),
    String(e.difficulty),
    arr(e.primaryMuscles),
    arr(e.secondaryMuscles),
    txt(e.cues),
    txt(e.tempo),
    json(e.keyPoints),
    json(e.progression),
    json(e.regression),
    json(e.commonFaults),
    json(e.variations),
    json(e.citation),
    "'aasfp'",
  ].join(", ")})`;
}

const sql = `-- ============================================================================
-- AASFP exercise catalog seed — GENERATED FILE, do not edit by hand.
-- Source: web/lib/exercise-library.ts  →  scripts/gen-exercise-seed.mjs
--
-- Idempotent upsert by unique name. Adds the AASFP exercises (source='aasfp')
-- and enriches any existing row of the same name. The original 'core' 38 rows
-- (0004_exercise_db_seed.sql) are left untouched unless a name matches.
-- ============================================================================

insert into exercise_db (${COLS.join(", ")}) values
${AASFP_EXERCISES.map(row).join(",\n")}
on conflict (name) do update set
  name_zh           = excluded.name_zh,
  muscle_group      = excluded.muscle_group,
  equipment         = excluded.equipment,
  equipment_options = excluded.equipment_options,
  level             = excluded.level,
  difficulty        = excluded.difficulty,
  primary_muscles   = excluded.primary_muscles,
  secondary_muscles = excluded.secondary_muscles,
  cues              = excluded.cues,
  tempo             = excluded.tempo,
  key_points        = excluded.key_points,
  progression       = excluded.progression,
  regression        = excluded.regression,
  common_faults     = excluded.common_faults,
  variations        = excluded.variations,
  citation          = excluded.citation,
  source            = excluded.source;
`;

const out = resolve(here, "../supabase/migrations/0028_exercise_db_aasfp_seed.sql");
writeFileSync(out, sql);
console.log(`Wrote ${out} (${AASFP_EXERCISES.length} exercises)`);
