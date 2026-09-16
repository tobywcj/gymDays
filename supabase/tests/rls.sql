-- ============================================================================
-- M2 — RLS tests. Run after 0001_init.sql is applied.
--
-- Strategy: simulate Supabase Auth by SET'ing request.jwt.claims and SET ROLE
-- authenticated. Use a third superuser-style session (postgres / service_role)
-- to seed cross-tenant fixtures.
--
-- Exits non-zero on the first failed assertion (\set ON_ERROR_STOP 1 below).
-- ============================================================================

\set ON_ERROR_STOP 1
\set QUIET 1

-- Clean slate for repeatable runs
set client_min_messages = warning;
truncate client_memory, agent_runs, integration_tokens, messages, messaging_threads,
         progress_reports, workouts, activities, meal_plans, programs, clients, trainers
         restart identity cascade;
set client_min_messages = notice;

-- ─── Seed two trainers, each with one client ───────────────────────────────
insert into trainers(id, email, full_name) values
  ('11111111-1111-1111-1111-111111111111', 'a@gym.test', 'Trainer A'),
  ('22222222-2222-2222-2222-222222222222', 'b@gym.test', 'Trainer B');

insert into clients(id, trainer_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Client A1'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Client B1');

insert into client_memory(trainer_id, client_id, kind, content) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'onboarding_note', 'A1 memory: hates burpees'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'onboarding_note', 'B1 memory: marathon goal');

-- ─── Test 1: Trainer B cannot SELECT Trainer A's client ────────────────────
set role authenticated;
set request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';

do $$
declare cnt int;
begin
  select count(*) into cnt from clients where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if cnt <> 0 then
    raise exception 'FAIL test1: trainer B saw trainer A''s client (cnt=%)', cnt;
  end if;
  select count(*) into cnt from clients;
  if cnt <> 1 then
    raise exception 'FAIL test1: trainer B should see exactly their 1 client (cnt=%)', cnt;
  end if;
  raise notice 'PASS test1: trainer B isolated from trainer A''s clients';
end$$;

-- ─── Test 2: client_memory invisible across clients under agent-scoped JWT ─
-- Trainer A's session, scoped to client A1 via JWT — must NOT see other clients'
-- memory rows (even within their own tenant, in the agent-scoped case).
reset role;
reset request.jwt.claims;

-- Seed a SECOND client under trainer A so we can verify per-client scoping
-- within the same tenant.
insert into clients(id, trainer_id, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'Client A2');
insert into client_memory(trainer_id, client_id, kind, content) values
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'preference', 'A2 memory: prefers AM sessions');

set role authenticated;
set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","client_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

do $$
declare cnt int;
begin
  -- Should see A1's memory (scoped to A1)
  select count(*) into cnt from client_memory where client_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if cnt <> 1 then
    raise exception 'FAIL test2a: A1-scoped JWT should see A1 memory (cnt=%)', cnt;
  end if;
  -- Should NOT see A2's memory (different client, same trainer)
  select count(*) into cnt from client_memory where client_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  if cnt <> 0 then
    raise exception 'FAIL test2b: A1-scoped JWT leaked A2 memory (cnt=%)', cnt;
  end if;
  -- Total visible rows = 1
  select count(*) into cnt from client_memory;
  if cnt <> 1 then
    raise exception 'FAIL test2c: A1-scoped JWT should see exactly 1 row (cnt=%)', cnt;
  end if;
  raise notice 'PASS test2: client_memory strictly scoped by JWT client_id claim';
end$$;

-- ─── Test 3: Unscoped trainer JWT can see all their own clients' memory ────
set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';
do $$
declare cnt int;
begin
  select count(*) into cnt from client_memory;
  if cnt <> 2 then
    raise exception 'FAIL test3: trainer JWT (no client_id) should see both A1 and A2 memory (cnt=%)', cnt;
  end if;
  -- But still NOT trainer B's memory
  select count(*) into cnt from client_memory where client_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  if cnt <> 0 then
    raise exception 'FAIL test3: trainer A leaked trainer B''s memory (cnt=%)', cnt;
  end if;
  raise notice 'PASS test3: unscoped trainer JWT sees own memory only';
end$$;

-- ─── Test 4: Write attempt across tenants is blocked ───────────────────────
do $$
declare ok boolean := false;
begin
  begin
    -- Trainer A's JWT trying to insert a row tagged as trainer B → blocked by WITH CHECK
    insert into clients(trainer_id, name) values ('22222222-2222-2222-2222-222222222222', 'should fail');
  exception when others then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL test4: cross-tenant insert was not blocked';
  end if;
  raise notice 'PASS test4: cross-tenant insert blocked by WITH CHECK';
end$$;

reset role;
reset request.jwt.claims;

select 'ALL RLS TESTS PASSED' as result;
