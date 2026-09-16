-- ============================================================================
-- M13 — Screening + assessment RLS + computed-column tests.
-- Run after 0001_init.sql … 0016_client_screenings.sql are applied.
-- ============================================================================

\set ON_ERROR_STOP 1
\set QUIET 1

set client_min_messages = warning;
truncate fitness_assessments, postural_assessments, client_health_metrics,
         client_screenings, client_memory, clients, trainers
         restart identity cascade;
set client_min_messages = notice;

-- ─── Seed two trainers, one client each ─────────────────────────────────────
insert into trainers(id, email, full_name) values
  ('11111111-1111-1111-1111-111111111111', 'a@gym.test', 'Trainer A'),
  ('22222222-2222-2222-2222-222222222222', 'b@gym.test', 'Trainer B');

insert into clients(id, trainer_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Client A1'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Client B1');

-- ─── Test 1: trainer-cross-tenant RLS on client_screenings ─────────────────
-- Trainer A inserts a screening; trainer B's JWT cannot see it.
insert into client_screenings(trainer_id, client_id, parq, medical_history, cvd_risk) values (
  '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '{"heart_condition": false, "chest_pain_activity": false, "chest_pain_rest": false, "dizziness": false, "bone_joint": false, "blood_pressure_med": false, "other_reason": false}'::jsonb,
  '{"chronic": {"hypertension": false, "diabetes": false, "asthma": false, "anemia": false}, "beta_blockers": false}'::jsonb,
  '{"age": 30, "sex": "m", "family_history": false, "smoking": false, "inactivity": false, "obesity": false}'::jsonb
);

set role authenticated;
set request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';

do $$
declare cnt int;
begin
  select count(*) into cnt from client_screenings;
  if cnt <> 0 then
    raise exception 'FAIL test1: trainer B saw % rows from client_screenings', cnt;
  end if;
  raise notice 'PASS test1: client_screenings isolated by trainer';
end$$;

-- ─── Test 2: medical_clearance_required computed from PAR-Q "Yes" ──────────
reset role;
reset request.jwt.claims;

insert into client_screenings(trainer_id, client_id, parq, medical_history, cvd_risk) values (
  '22222222-2222-2222-2222-222222222222',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '{"heart_condition": true, "chest_pain_activity": false, "chest_pain_rest": false, "dizziness": false, "bone_joint": false, "blood_pressure_med": false, "other_reason": false}'::jsonb,
  '{}'::jsonb,
  '{"age": 50, "sex": "m", "family_history": true, "smoking": true, "inactivity": false, "obesity": false}'::jsonb
);

do $$
declare
  v_clearance boolean;
  v_yes int;
  v_cvd int;
begin
  select medical_clearance_required, parq_yes_count, cvd_risk_factor_count
    into v_clearance, v_yes, v_cvd
    from client_screenings
   where client_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  if v_clearance is not true then
    raise exception 'FAIL test2a: medical_clearance_required should be TRUE (got %)', v_clearance;
  end if;
  if v_yes <> 1 then
    raise exception 'FAIL test2b: parq_yes_count expected 1, got %', v_yes;
  end if;
  -- 3 CVD risks: age 50/m (yes, ≥45), family_history, smoking
  if v_cvd <> 3 then
    raise exception 'FAIL test2c: cvd_risk_factor_count expected 3, got %', v_cvd;
  end if;
  raise notice 'PASS test2: computed flags (clearance / parq yes / cvd) correct';
end$$;

-- ─── Test 3: insert into client_health_metrics fires memory sync ───────────
insert into client_health_metrics(
  trainer_id, client_id, bp_systolic, bp_diastolic, resting_hr,
  weight_kg, bmi, body_fat_pct, source
) values (
  '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  118, 76, 60, 72.5, 22.1, 18.4, 'intake'
);

do $$
declare cnt int;
begin
  select count(*) into cnt from client_memory
   where client_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     and kind = 'health_metric';
  if cnt <> 1 then
    raise exception 'FAIL test3: expected 1 health_metric memory row, got %', cnt;
  end if;
  raise notice 'PASS test3: health metric mirrored to client_memory';
end$$;

-- ─── Test 4: high BP flips training_blocked on the client row ──────────────
insert into client_health_metrics(
  trainer_id, client_id, bp_systolic, bp_diastolic, source
) values (
  '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  215, 118, 'session'
);

do $$
declare v_blocked boolean; v_reason text;
begin
  select training_blocked, training_blocked_reason
    into v_blocked, v_reason
    from clients where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  if v_blocked is not true then
    raise exception 'FAIL test4: training_blocked should be TRUE after BP 215/118';
  end if;
  if v_reason is null or v_reason !~ '215' then
    raise exception 'FAIL test4: training_blocked_reason missing or wrong (%)', v_reason;
  end if;
  raise notice 'PASS test4: BP ≥ 200/110 triggers training_blocked';
end$$;

-- ─── Test 5: screening memory trigger writes a screening_note row ──────────
do $$
declare cnt int;
begin
  select count(*) into cnt from client_memory
   where client_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
     and kind = 'screening_note';
  if cnt < 1 then
    raise exception 'FAIL test5: expected ≥1 screening_note memory row, got %', cnt;
  end if;
  raise notice 'PASS test5: screening mirrored to client_memory';
end$$;

\echo ALL SCREENING TESTS PASSED
