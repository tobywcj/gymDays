-- ============================================================================
-- M19 — Two-way feedback on screening alert states
--
-- The screening flags (medical_clearance_required, training_blocked) start
-- life as one-way alerts. This migration adds explicit trainer-side ACK
-- actions:
--
--   record_clearance(client_id, note)   → stamps clearance_received_at on
--                                          clients + writes a
--                                          'clearance_update' memory row.
--   clear_training_block(client_id, note) → flips training_blocked=false +
--                                          writes a 'training_unblock'
--                                          memory row carrying the prior
--                                          reason for audit.
--
-- Every action writes a client_memory row so RAG-based agents (Planner,
-- Progress, Nutrition, Messaging) see the updated state automatically.
-- The Planner's deterministic design_battery() also reads clearance_received_at
-- directly so it stops gating max-effort tests once cleared.
-- ============================================================================

-- ─── 1. New memory kinds ────────────────────────────────────────────────────
do $$
begin
  alter type memory_kind add value if not exists 'clearance_update';
  alter type memory_kind add value if not exists 'training_unblock';
exception when others then null; end$$;

-- ─── 2. Clearance state on clients ──────────────────────────────────────────
alter table clients
  add column if not exists clearance_received_at timestamptz,
  add column if not exists clearance_note text;

-- ─── 3. record_clearance RPC ────────────────────────────────────────────────
create or replace function public.record_clearance(
  p_client_id uuid,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trainer_id uuid;
begin
  select trainer_id into v_trainer_id from clients where id = p_client_id;
  if v_trainer_id is null then
    raise exception 'client_not_found' using errcode = '22023';
  end if;
  if v_trainer_id <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update clients
     set clearance_received_at = now(),
         clearance_note = p_note
   where id = p_client_id;

  insert into client_memory (trainer_id, client_id, kind, content)
  values (
    v_trainer_id, p_client_id, 'clearance_update',
    format(
      'Medical clearance received on %s. Trainer note: %s. '
      'Planner may now prescribe max-effort tests where otherwise gated by PAR-Q answers.',
      to_char(now(), 'YYYY-MM-DD'),
      coalesce(nullif(p_note, ''), '(no note)')
    )
  );
end$$;

revoke all on function public.record_clearance(uuid, text) from public;
grant execute on function public.record_clearance(uuid, text) to authenticated;

-- ─── 4. clear_training_block RPC ────────────────────────────────────────────
create or replace function public.clear_training_block(
  p_client_id uuid,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trainer_id uuid;
  v_prior_reason text;
begin
  select trainer_id, training_blocked_reason
    into v_trainer_id, v_prior_reason
  from clients where id = p_client_id;
  if v_trainer_id is null then
    raise exception 'client_not_found' using errcode = '22023';
  end if;
  if v_trainer_id <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update clients
     set training_blocked = false,
         training_blocked_reason = null
   where id = p_client_id;

  insert into client_memory (trainer_id, client_id, kind, content)
  values (
    v_trainer_id, p_client_id, 'training_unblock',
    format(
      'Training unblocked on %s. Prior block reason: %s. Trainer note: %s.',
      to_char(now(), 'YYYY-MM-DD'),
      coalesce(v_prior_reason, '(unknown)'),
      coalesce(nullif(p_note, ''), '(no note)')
    )
  );
end$$;

revoke all on function public.clear_training_block(uuid, text) from public;
grant execute on function public.clear_training_block(uuid, text) to authenticated;
