-- ============================================================================
-- M13 — Client screening + first-lesson assessment schema
--
-- Permanent, RLS-scoped storage for every datum the PAR-Q questionnaire and
-- first-lesson assessment produce. Every write is mirrored into client_memory
-- so all downstream agents (Planner, Progress, Nutrition, Messaging) pick it up
-- via existing RAG (SearchClientMemory).
--
-- Safety invariants (also enforced at the agent-tool layer in M18):
--   - Any PAR-Q "Yes"          → medical_clearance_required = true
--   - BP ≥ 200/110 mmHg        → training_blocked = true
--   - Beta-blockers in meds    → cardio tests must be RPE-anchored
--   - ≥ 2 CVD risk factors     → sub-max cardio only
-- ============================================================================

-- ─── 1. Extend client_memory kinds ──────────────────────────────────────────
do $$
begin
  alter type memory_kind add value if not exists 'screening_note';
  alter type memory_kind add value if not exists 'assessment_result';
  alter type memory_kind add value if not exists 'postural_finding';
  alter type memory_kind add value if not exists 'health_metric';
exception when others then null; end$$;

-- ─── 2. Link clients to Supabase Auth users (created in M15 signup step) ───
alter table clients
  add column if not exists auth_user_id uuid unique,
  add column if not exists training_blocked boolean not null default false,
  add column if not exists training_blocked_reason text;

-- ─── 3. client_screenings ───────────────────────────────────────────────────
-- One row per submitted PAR-Q. Updates allowed (client can re-submit on
-- trainer request) but trainer_id/client_id are immutable.
create table if not exists client_screenings (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,

  -- Part 1: PAR-Q (7 standard items; jsonb keeps structure flexible for future revisions)
  -- Shape: { heart_condition: bool, chest_pain_activity: bool, chest_pain_rest: bool,
  --          dizziness: bool, bone_joint: bool, blood_pressure_med: bool,
  --          other_reason: bool, free_text: string }
  parq jsonb not null default '{}'::jsonb,

  -- Part 2: Medical / Injury History
  -- Shape: { previous_injuries: [string], medications: [string], beta_blockers: bool,
  --          chronic: { hypertension: bool, diabetes: bool, anemia: bool, asthma: bool },
  --          notes: string }
  medical_history jsonb not null default '{}'::jsonb,

  -- Part 3: CVD risk factors
  -- Shape: { age: int, sex: 'm'|'f', family_history: bool, smoking: bool,
  --          inactivity: bool, obesity: bool, bmi: numeric, waist_cm: numeric }
  cvd_risk jsonb not null default '{}'::jsonb,

  -- Computed: count of "Yes" answers across PAR-Q (excluding free_text)
  parq_yes_count int generated always as (
    (case when (parq->>'heart_condition')::boolean   then 1 else 0 end) +
    (case when (parq->>'chest_pain_activity')::boolean then 1 else 0 end) +
    (case when (parq->>'chest_pain_rest')::boolean   then 1 else 0 end) +
    (case when (parq->>'dizziness')::boolean         then 1 else 0 end) +
    (case when (parq->>'bone_joint')::boolean        then 1 else 0 end) +
    (case when (parq->>'blood_pressure_med')::boolean then 1 else 0 end) +
    (case when (parq->>'other_reason')::boolean      then 1 else 0 end)
  ) stored,

  medical_clearance_required boolean generated always as (
    coalesce(
      ((parq->>'heart_condition')::boolean) or
      ((parq->>'chest_pain_activity')::boolean) or
      ((parq->>'chest_pain_rest')::boolean) or
      ((parq->>'dizziness')::boolean) or
      ((parq->>'bone_joint')::boolean) or
      ((parq->>'blood_pressure_med')::boolean) or
      ((parq->>'other_reason')::boolean),
      false
    )
  ) stored,

  cvd_risk_factor_count int generated always as (
    (case when (cvd_risk->>'family_history')::boolean then 1 else 0 end) +
    (case when (cvd_risk->>'smoking')::boolean        then 1 else 0 end) +
    (case when (cvd_risk->>'inactivity')::boolean     then 1 else 0 end) +
    (case when (cvd_risk->>'obesity')::boolean        then 1 else 0 end) +
    (case
       when (cvd_risk->>'sex') = 'm' and ((cvd_risk->>'age')::int) >= 45 then 1
       when (cvd_risk->>'sex') = 'f' and ((cvd_risk->>'age')::int) >= 55 then 1
       else 0
     end)
  ) stored,

  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_client_screenings_client
  on client_screenings(client_id, submitted_at desc);

-- ─── 4. client_health_metrics — time-series BP/RHR/InBody ──────────────────
create table if not exists client_health_metrics (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  recorded_at timestamptz not null default now(),

  bp_systolic int,
  bp_diastolic int,
  resting_hr int,

  weight_kg numeric(6,2),
  bmi numeric(5,2),
  body_fat_pct numeric(5,2),
  fat_free_mass_kg numeric(6,2),
  bmr_kcal int,
  waist_hip_ratio numeric(5,3),
  total_body_water_pct numeric(5,2),

  source text not null default 'session'
    check (source in ('intake', 'session', 'self-report')),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_health_metrics_client
  on client_health_metrics(client_id, recorded_at desc);

-- ─── 5. postural_assessments — Static + Functional Movement Screen ─────────
do $$ begin
  create type postural_severity as enum ('none','mild','moderate','severe');
exception when duplicate_object then null; end $$;

create table if not exists postural_assessments (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  assessed_at timestamptz not null default now(),

  -- Static Postural Analysis
  upper_crossed postural_severity not null default 'none',
  upper_crossed_notes text,
  lower_crossed postural_severity not null default 'none',
  lower_crossed_notes text,
  pronation_distortion postural_severity not null default 'none',
  pronation_distortion_notes text,
  scoliosis postural_severity not null default 'none',
  scoliosis_notes text,

  -- Functional Movement Screen
  -- Shape per movement: { result: 'pass'|'fail'|'compensation', compensations: [string], notes: string }
  overhead_squat jsonb not null default '{}'::jsonb,
  hip_hinge jsonb not null default '{}'::jsonb,
  single_leg_squat jsonb not null default '{}'::jsonb,
  wall_angel jsonb not null default '{}'::jsonb,

  summary text,
  created_at timestamptz not null default now()
);
create index if not exists idx_postural_client
  on postural_assessments(client_id, assessed_at desc);

-- ─── 6. fitness_assessments — designed battery + recorded results ──────────
create table if not exists fitness_assessments (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  assessed_at timestamptz not null default now(),

  -- Battery designed by the Planner agent (or trainer manually).
  -- Shape: { battery: [{test, rationale, contraindication_check}],
  --          skipped: [{test, reason}] }
  battery jsonb not null default '{}'::jsonb,

  -- Results captured during the session.
  -- Shape: { bench_3rm_kg, squat_3rm_kg, handgrip_kg, plank_seconds, push_up_count,
  --          pull_up_count, crunch_count, sit_and_reach_cm,
  --          rockport_vo2, mile_15_time, chester_level, lactate_threshold_hr,
  --          bess_errors }
  results jsonb not null default '{}'::jsonb,

  designed_by text not null default 'planner_agent'
    check (designed_by in ('planner_agent', 'trainer_manual')),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_fitness_assessments_client
  on fitness_assessments(client_id, assessed_at desc);

-- ─── 7. RLS ─────────────────────────────────────────────────────────────────
alter table client_screenings      enable row level security;
alter table client_health_metrics  enable row level security;
alter table postural_assessments   enable row level security;
alter table fitness_assessments    enable row level security;

drop policy if exists client_screenings_owner on client_screenings;
create policy client_screenings_owner on client_screenings
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

drop policy if exists client_health_metrics_owner on client_health_metrics;
create policy client_health_metrics_owner on client_health_metrics
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

drop policy if exists postural_assessments_owner on postural_assessments;
create policy postural_assessments_owner on postural_assessments
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

drop policy if exists fitness_assessments_owner on fitness_assessments;
create policy fitness_assessments_owner on fitness_assessments
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

-- Client-self read: the signed-in client (auth_user_id = auth.uid()) can read
-- their own screening + health metrics. Used by the post-signup confirmation
-- screen so the client can review what was submitted.
drop policy if exists client_screenings_self_read on client_screenings;
create policy client_screenings_self_read on client_screenings
  for select to authenticated
  using (client_id in (select id from clients where auth_user_id = auth.uid()));

drop policy if exists client_health_metrics_self_read on client_health_metrics;
create policy client_health_metrics_self_read on client_health_metrics
  for select to authenticated
  using (client_id in (select id from clients where auth_user_id = auth.uid()));

-- ─── 8. Memory-sync triggers ────────────────────────────────────────────────
-- Every write here lands as a row in client_memory (kind-tagged) so RAG picks
-- it up. Embeddings are left NULL; the AI service backfills them in a sweep.
create or replace function public._summarize_screening(s client_screenings)
returns text language sql immutable as $$
  select format(
    E'Screening submitted %s. PAR-Q yes count=%s. Medical clearance required: %s. '
    'Chronic: hypertension=%s diabetes=%s asthma=%s anemia=%s. '
    'Beta-blockers: %s. CVD risk factor count: %s. '
    'Medications: %s. Injuries: %s.',
    to_char(s.submitted_at, 'YYYY-MM-DD'),
    s.parq_yes_count,
    s.medical_clearance_required,
    coalesce((s.medical_history->'chronic'->>'hypertension')::text, 'false'),
    coalesce((s.medical_history->'chronic'->>'diabetes')::text, 'false'),
    coalesce((s.medical_history->'chronic'->>'asthma')::text, 'false'),
    coalesce((s.medical_history->'chronic'->>'anemia')::text, 'false'),
    coalesce((s.medical_history->>'beta_blockers')::text, 'false'),
    s.cvd_risk_factor_count,
    coalesce(s.medical_history->>'medications', '[]'),
    coalesce(s.medical_history->>'notes', '')
  )
$$;

create or replace function public._sync_screening_memory()
returns trigger language plpgsql as $$
begin
  insert into client_memory (trainer_id, client_id, kind, content)
  values (new.trainer_id, new.client_id, 'screening_note',
          public._summarize_screening(new));
  return new;
end$$;

drop trigger if exists trg_screening_memory on client_screenings;
create trigger trg_screening_memory
  after insert or update on client_screenings
  for each row execute function public._sync_screening_memory();

create or replace function public._sync_health_metric_memory()
returns trigger language plpgsql as $$
declare
  v_blocked boolean;
begin
  insert into client_memory (trainer_id, client_id, kind, content)
  values (
    new.trainer_id, new.client_id, 'health_metric',
    format(
      E'Health metrics %s (source=%s). BP=%s/%s mmHg, RHR=%s bpm, '
      'weight=%s kg, BMI=%s, body_fat=%s%%, FFM=%s kg, BMR=%s kcal, WHR=%s, TBW=%s%%.',
      to_char(new.recorded_at, 'YYYY-MM-DD'), new.source,
      coalesce(new.bp_systolic::text, '?'), coalesce(new.bp_diastolic::text, '?'),
      coalesce(new.resting_hr::text, '?'),
      coalesce(new.weight_kg::text, '?'), coalesce(new.bmi::text, '?'),
      coalesce(new.body_fat_pct::text, '?'), coalesce(new.fat_free_mass_kg::text, '?'),
      coalesce(new.bmr_kcal::text, '?'), coalesce(new.waist_hip_ratio::text, '?'),
      coalesce(new.total_body_water_pct::text, '?')
    )
  );

  -- BP safety gate: flip training_blocked on the client row if BP ≥ 200/110.
  v_blocked := (new.bp_systolic is not null and new.bp_systolic >= 200)
            or (new.bp_diastolic is not null and new.bp_diastolic >= 110);
  if v_blocked then
    update clients
       set training_blocked = true,
           training_blocked_reason = format('BP %s/%s mmHg recorded %s',
             new.bp_systolic, new.bp_diastolic, to_char(new.recorded_at, 'YYYY-MM-DD'))
     where id = new.client_id;
  end if;
  return new;
end$$;

drop trigger if exists trg_health_metric_memory on client_health_metrics;
create trigger trg_health_metric_memory
  after insert on client_health_metrics
  for each row execute function public._sync_health_metric_memory();

create or replace function public._sync_postural_memory()
returns trigger language plpgsql as $$
begin
  insert into client_memory (trainer_id, client_id, kind, content)
  values (
    new.trainer_id, new.client_id, 'postural_finding',
    format(
      E'Postural assessment %s. Upper crossed=%s, Lower crossed=%s, '
      'Pronation distortion=%s, Scoliosis=%s. Summary: %s',
      to_char(new.assessed_at, 'YYYY-MM-DD'),
      new.upper_crossed, new.lower_crossed,
      new.pronation_distortion, new.scoliosis,
      coalesce(new.summary, '')
    )
  );
  return new;
end$$;

drop trigger if exists trg_postural_memory on postural_assessments;
create trigger trg_postural_memory
  after insert on postural_assessments
  for each row execute function public._sync_postural_memory();

create or replace function public._sync_fitness_assessment_memory()
returns trigger language plpgsql as $$
begin
  insert into client_memory (trainer_id, client_id, kind, content)
  values (
    new.trainer_id, new.client_id, 'assessment_result',
    format(
      E'Fitness assessment %s (designed by %s). Battery: %s. Results: %s.',
      to_char(new.assessed_at, 'YYYY-MM-DD'),
      new.designed_by,
      coalesce(new.battery::text, '{}'),
      coalesce(new.results::text, '{}')
    )
  );
  return new;
end$$;

drop trigger if exists trg_fitness_assessment_memory on fitness_assessments;
create trigger trg_fitness_assessment_memory
  after insert or update on fitness_assessments
  for each row execute function public._sync_fitness_assessment_memory();

-- ─── 9. Public RPCs for the onboarding/[token] flow (M15) ──────────────────
-- Replaces invite_submit's profile-only behavior with structured screening +
-- auth-user linkage. The client signs up via supabase.auth.signUp() first,
-- gets an auth_user_id, then calls this RPC.
create or replace function public.invite_submit_screening(
  p_token text,
  p_screening jsonb,
  p_auth_user_id uuid,
  p_language text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_trainer_id uuid;
  v_invite_id uuid;
begin
  select i.id, i.client_id, i.trainer_id
    into v_invite_id, v_client_id, v_trainer_id
  from onboarding_invites i
  where i.token = p_token
    and i.accepted_at is null
    and i.expires_at > now()
  for update;

  if v_invite_id is null then
    raise exception 'invite_invalid' using errcode = '22023';
  end if;

  -- Link the client row to the new auth user.
  update clients
     set auth_user_id = p_auth_user_id,
         language = coalesce(p_language, language),
         email = coalesce(p_screening->>'email', email)
   where id = v_client_id;

  insert into client_screenings (
    trainer_id, client_id, parq, medical_history, cvd_risk
  ) values (
    v_trainer_id, v_client_id,
    coalesce(p_screening->'parq', '{}'::jsonb),
    coalesce(p_screening->'medical_history', '{}'::jsonb),
    coalesce(p_screening->'cvd_risk', '{}'::jsonb)
  );

  update onboarding_invites set accepted_at = now() where id = v_invite_id;
  return v_client_id;
end$$;

revoke all on function public.invite_submit_screening(text, jsonb, uuid, text) from public;
grant execute on function public.invite_submit_screening(text, jsonb, uuid, text)
  to anon, authenticated;

-- ─── 10. Realtime publication (M16 subscribes from trainer dashboard) ──────
-- Best-effort: silently skip if the publication doesn't exist (local Postgres).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table client_screenings';
  end if;
exception when duplicate_object then null;
end$$;
