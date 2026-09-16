-- ============================================================================
-- Phase 3 — RLS for client-auth, portal and trainer-tooling tables
-- (migrations 0025 client auth, 0030/0034 sessions, 0036 trainer_secrets,
--  0038 program_change_requests, 0039–0043 client_injury_log,
--  0049 scheduled_agents, 0051 agent_source_prefs).
--
-- SAFE ON CLOUD: the whole file runs in one transaction that ROLLS BACK, and
-- it never truncates — fixtures use dedicated UUIDs. Exits non-zero on the
-- first failed assertion.
--
-- Actors:
--   trainer A  feedface-0000-4000-8000-00000000000a   owns client A1
--   trainer B  feedface-0000-4000-8000-00000000000b   owns client B1
--   client A1  auth user feedface-0000-4000-8000-0000000000a1
--   client B1  auth user feedface-0000-4000-8000-0000000000b1
-- ============================================================================

\set ON_ERROR_STOP 1
\set QUIET 1

begin;

-- ─── Fixtures (as table owner, bypassing RLS) ───────────────────────────────
insert into trainers(id, email, full_name) values
  ('feedface-0000-4000-8000-00000000000a', 'rls-a@portal.test', 'RLS Trainer A'),
  ('feedface-0000-4000-8000-00000000000b', 'rls-b@portal.test', 'RLS Trainer B');

insert into clients(id, trainer_id, name, auth_user_id) values
  ('feedface-0000-4000-8000-0000000c11a1', 'feedface-0000-4000-8000-00000000000a', 'RLS Client A1',
   'feedface-0000-4000-8000-0000000000a1'),
  ('feedface-0000-4000-8000-0000000c11b1', 'feedface-0000-4000-8000-00000000000b', 'RLS Client B1',
   'feedface-0000-4000-8000-0000000000b1');

insert into sessions(trainer_id, client_id, scheduled_at, title) values
  ('feedface-0000-4000-8000-00000000000a', 'feedface-0000-4000-8000-0000000c11a1', now() + interval '1 day', 'A1 session'),
  ('feedface-0000-4000-8000-00000000000b', 'feedface-0000-4000-8000-0000000c11b1', now() + interval '1 day', 'B1 session');

insert into trainer_secrets(trainer_id, key, value) values
  ('feedface-0000-4000-8000-00000000000a', 'ANTHROPIC_API_KEY', 'sk-test-a');

insert into scheduled_agents(trainer_id, name, flow, frequency, next_run_at) values
  ('feedface-0000-4000-8000-00000000000a', 'A daily', 'daily-reminder', 'daily', now());

insert into client_injury_log(client_id, trainer_id, source, note) values
  ('feedface-0000-4000-8000-0000000c11a1', 'feedface-0000-4000-8000-00000000000a', 'trainer', 'A1 knee');

-- ─── Test 1: client auth user sees only their own client row ───────────────
set role authenticated;
set request.jwt.claims to '{"sub":"feedface-0000-4000-8000-0000000000a1","role":"authenticated"}';

do $$
declare cnt int;
begin
  select count(*) into cnt from clients where id::text like 'feedface-%';
  if cnt <> 1 then raise exception 'FAIL test1: client A1 saw % client rows (want 1)', cnt; end if;
  raise notice 'PASS test1: clients_self_read scoped to own row';
end$$;

-- ─── Test 2: client reads own sessions only, cannot write them ─────────────
do $$
declare cnt int;
begin
  select count(*) into cnt from sessions where client_id::text like 'feedface-%';
  if cnt <> 1 then raise exception 'FAIL test2a: client A1 saw % sessions (want 1)', cnt; end if;

  begin
    insert into sessions(trainer_id, client_id, scheduled_at)
    values ('feedface-0000-4000-8000-00000000000a', 'feedface-0000-4000-8000-0000000c11a1', now());
    raise exception 'FAIL test2b: client was allowed to insert a session';
  exception when insufficient_privilege then null;
  end;

  update sessions set status = 'cancelled' where client_id = 'feedface-0000-4000-8000-0000000c11a1';
  get diagnostics cnt = row_count;
  if cnt <> 0 then raise exception 'FAIL test2c: client updated % sessions', cnt; end if;
  raise notice 'PASS test2: sessions — client read-own, no writes';
end$$;

-- ─── Test 3: clients never see trainer secrets or scheduled agents ─────────
do $$
declare cnt int;
begin
  select count(*) into cnt from trainer_secrets;
  if cnt <> 0 then raise exception 'FAIL test3a: client saw % trainer_secrets', cnt; end if;
  select count(*) into cnt from scheduled_agents;
  if cnt <> 0 then raise exception 'FAIL test3b: client saw % scheduled_agents', cnt; end if;
  raise notice 'PASS test3: trainer_secrets + scheduled_agents hidden from clients';
end$$;

-- ─── Test 4: program-change requests — client self-insert only ─────────────
do $$
declare cnt int;
begin
  insert into program_change_requests(trainer_id, client_id, body)
  values ('feedface-0000-4000-8000-00000000000a', 'feedface-0000-4000-8000-0000000c11a1', 'Swap squats for leg press');

  begin  -- request on behalf of someone else's client
    insert into program_change_requests(trainer_id, client_id, body)
    values ('feedface-0000-4000-8000-00000000000b', 'feedface-0000-4000-8000-0000000c11b1', 'spoof');
    raise exception 'FAIL test4a: client inserted a request for another client';
  exception when insufficient_privilege then null;
  end;

  begin  -- own client, but routed to the wrong trainer
    insert into program_change_requests(trainer_id, client_id, body)
    values ('feedface-0000-4000-8000-00000000000b', 'feedface-0000-4000-8000-0000000c11a1', 'misrouted');
    raise exception 'FAIL test4b: client inserted a request with a spoofed trainer_id';
  exception when insufficient_privilege then null;
  end;

  update program_change_requests set status = 'approved'
   where client_id = 'feedface-0000-4000-8000-0000000c11a1';
  get diagnostics cnt = row_count;
  if cnt <> 0 then raise exception 'FAIL test4c: client self-approved % requests', cnt; end if;

  select count(*) into cnt from program_change_requests where client_id::text like 'feedface-%';
  if cnt <> 1 then raise exception 'FAIL test4d: client saw % requests (want 1)', cnt; end if;
  raise notice 'PASS test4: program_change_requests — self insert/read, no spoofing, no approval';
end$$;

-- ─── Test 5: injury log — client may only file an open client_report ───────
do $$
declare cnt int;
begin
  insert into client_injury_log(client_id, trainer_id, source, note)
  values ('feedface-0000-4000-8000-0000000c11a1', null, 'client_report', 'Shoulder twinge');

  begin
    insert into client_injury_log(client_id, trainer_id, source, note)
    values ('feedface-0000-4000-8000-0000000c11a1', null, 'trainer', 'forged trainer note');
    raise exception 'FAIL test5a: client inserted a trainer-sourced injury entry';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into client_injury_log(client_id, trainer_id, source, note, resolved_at)
    values ('feedface-0000-4000-8000-0000000c11a1', null, 'client_report', 'pre-resolved', now());
    raise exception 'FAIL test5b: client inserted a pre-resolved injury';
  exception when insufficient_privilege then null;
  end;

  update client_injury_log set resolved_at = now()
   where client_id = 'feedface-0000-4000-8000-0000000c11a1';
  get diagnostics cnt = row_count;
  if cnt <> 0 then raise exception 'FAIL test5c: client resolved % injuries', cnt; end if;

  select count(*) into cnt from client_injury_log where client_id::text like 'feedface-%';
  if cnt <> 2 then raise exception 'FAIL test5d: client saw % injury rows (want 2)', cnt; end if;
  raise notice 'PASS test5: client_injury_log — client_report only, no resolve';
end$$;

-- ─── Test 6: trainer B is isolated from trainer A's data ───────────────────
set request.jwt.claims to '{"sub":"feedface-0000-4000-8000-00000000000b","role":"authenticated"}';

do $$
declare cnt int;
begin
  select count(*) into cnt from trainer_secrets where trainer_id = 'feedface-0000-4000-8000-00000000000a';
  if cnt <> 0 then raise exception 'FAIL test6a: trainer B saw A''s secrets'; end if;
  select count(*) into cnt from scheduled_agents where trainer_id = 'feedface-0000-4000-8000-00000000000a';
  if cnt <> 0 then raise exception 'FAIL test6b: trainer B saw A''s scheduled agents'; end if;
  select count(*) into cnt from program_change_requests where client_id = 'feedface-0000-4000-8000-0000000c11a1';
  if cnt <> 0 then raise exception 'FAIL test6c: trainer B saw A1''s requests'; end if;
  select count(*) into cnt from client_injury_log where client_id = 'feedface-0000-4000-8000-0000000c11a1';
  if cnt <> 0 then raise exception 'FAIL test6d: trainer B saw A1''s injury log'; end if;
  select count(*) into cnt from sessions where client_id = 'feedface-0000-4000-8000-0000000c11a1';
  if cnt <> 0 then raise exception 'FAIL test6e: trainer B saw A1''s sessions'; end if;

  begin
    insert into client_injury_log(client_id, trainer_id, source, note)
    values ('feedface-0000-4000-8000-0000000c11a1', 'feedface-0000-4000-8000-00000000000b', 'trainer', 'cross-tenant');
    raise exception 'FAIL test6f: trainer B wrote to A1''s injury log';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS test6: cross-trainer isolation on all Phase 3 tables';
end$$;

-- ─── Test 7: trainer A manages own client's data ───────────────────────────
set request.jwt.claims to '{"sub":"feedface-0000-4000-8000-00000000000a","role":"authenticated"}';

do $$
declare cnt int;
begin
  update program_change_requests set status = 'approved', resolved_at = now()
   where client_id = 'feedface-0000-4000-8000-0000000c11a1';
  get diagnostics cnt = row_count;
  if cnt <> 1 then raise exception 'FAIL test7a: trainer A approved % requests (want 1)', cnt; end if;

  update client_injury_log set resolved_at = now()
   where client_id = 'feedface-0000-4000-8000-0000000c11a1' and source = 'client_report';
  get diagnostics cnt = row_count;
  if cnt <> 1 then raise exception 'FAIL test7b: trainer A resolved % injuries (want 1)', cnt; end if;

  select count(*) into cnt from trainer_secrets where key = 'ANTHROPIC_API_KEY';
  if cnt <> 1 then raise exception 'FAIL test7c: trainer A saw % own secrets (want 1)', cnt; end if;

  begin
    insert into scheduled_agents(trainer_id, name, flow, frequency, next_run_at)
    values ('feedface-0000-4000-8000-00000000000a', 'bad', 'not-a-flow', 'daily', now());
    raise exception 'FAIL test7d: scheduled_agents accepted an unknown flow';
  exception when check_violation then null;
  end;
  raise notice 'PASS test7: trainer A approves requests, resolves injuries, reads own secrets';
end$$;

-- ─── Test 8: agent_source_prefs defaults to all-sources-on ─────────────────
reset role;
reset request.jwt.claims;

do $$
declare prefs jsonb;
begin
  select agent_source_prefs into prefs from clients where id = 'feedface-0000-4000-8000-0000000c11a1';
  if prefs is distinct from '{}'::jsonb then
    raise exception 'FAIL test8: agent_source_prefs default is % (want {})', prefs;
  end if;
  raise notice 'PASS test8: agent_source_prefs defaults to {}';
end$$;

rollback;
