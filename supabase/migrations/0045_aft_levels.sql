-- ============================================================================
-- AFT Enhancement System levels (APTHK10 handout).
--
-- Replaces the beginner/intermediate/advanced lens on the Programme library with
-- the AASFP 5-level "All-round Fitness Training" client-classification system:
--
--   blue   — dysfunctional / deconditioned (corrective, very stable, basic)
--   green  — prepared individuals (general aerobic + basic resistance)
--   yellow — active / recreational athletes (higher skill, hypertrophy, HIIT)
--   orange — trained athletes (max strength/power, complex, unstable, advanced)
--   red    — elite / pro athletes (sport-specific, highest complexity)
--
-- Two surfaces use it:
--  1. exercise_db.aft_level — every exercise is categorised so the library can be
--     filtered by colour level (backfilled deterministically below from the
--     existing level/difficulty/equipment/name signals).
--  2. clients.aft_level (+ rationale/signals/timestamp) — the Progress agent's
--     classification of where the client sits NOW, run on demand from the
--     Programme page's AFT card (the refresh button).
-- ============================================================================

-- ── exercise_db: per-exercise AFT category ──────────────────────────────────
alter table exercise_db
  add column if not exists aft_level text;

create index if not exists idx_exercise_db_aft_level on exercise_db(aft_level);

-- Deterministic backfill from the data we already have. Heuristic, intentionally
-- conservative; trainers/agents can override per row later.
update exercise_db set aft_level = case
  -- Blue: corrective / body-control / stability work at the simplest tier.
  when coalesce(level, 'beginner') = 'beginner'
       and name ~* 'plank|dead ?bug|bird ?dog|glute bridge|wall angel|clam|isometric|hip hinge|pelvic|balance|stabili|wall sit'
    then 'blue'
  -- Orange: advanced complexity, or intermediate on an unstable/suspension tool.
  when level = 'advanced' then 'orange'
  when level = 'intermediate'
       and (equipment in ('fitball', 'suspension', 'bosu')
            or 'fitball' = any(equipment_options)
            or 'suspension' = any(equipment_options)
            or 'bosu' = any(equipment_options))
    then 'orange'
  -- Yellow: general intermediate work.
  when level = 'intermediate' then 'yellow'
  -- Green: prepared-beginner default.
  when level = 'beginner' then 'green'
  -- Fallback on numeric difficulty when level is missing.
  else case
    when coalesce(difficulty, 2) >= 4 then 'orange'
    when coalesce(difficulty, 2) = 3 then 'yellow'
    when coalesce(difficulty, 2) <= 1 then 'green'
    else 'yellow'
  end
end
where aft_level is null;

-- ── clients: the Progress agent's AFT classification ────────────────────────
alter table clients
  add column if not exists aft_level         text,   -- blue|green|yellow|orange|red
  add column if not exists aft_rationale     text,   -- concise markdown rationale
  add column if not exists aft_signals       jsonb,  -- [{label, value}] evidence the agent used
  add column if not exists aft_classified_at timestamptz;
