-- ============================================================================
-- M4 — Onboarding invites
-- Trainer creates a client (basic fields), then shares /onboarding/<token>
-- with the client. Public page reads via a SECURITY DEFINER function that
-- enforces token + not-expired + not-already-accepted.
-- ============================================================================

create table if not exists onboarding_invites (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_onboarding_invites_token on onboarding_invites(token);

alter table onboarding_invites enable row level security;
drop policy if exists onboarding_invites_owner on onboarding_invites;
create policy onboarding_invites_owner on onboarding_invites
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

-- Public lookup (anon) — returns client_id IFF the token is live (not expired,
-- not yet accepted). Other rows / other tokens are unreachable.
create or replace function public.invite_lookup(p_token text)
returns table (client_id uuid, client_name text, trainer_name text, expires_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select c.id, c.name, t.full_name, i.expires_at
  from onboarding_invites i
  join clients c  on c.id = i.client_id
  join trainers t on t.id = i.trainer_id
  where i.token = p_token
    and i.accepted_at is null
    and i.expires_at > now()
$$;

revoke all on function public.invite_lookup(text) from public;
grant execute on function public.invite_lookup(text) to anon, authenticated;

-- Public submit — updates the client's profile + marks invite accepted.
-- Returns the client_id on success; throws otherwise.
create or replace function public.invite_submit(p_token text, p_profile jsonb)
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

  update clients
     set profile = p_profile,
         goal = coalesce(p_profile ->> 'goal', goal),
         equipment = coalesce(p_profile -> 'equipment', equipment),
         schedule = coalesce(p_profile -> 'schedule', schedule),
         injury_history = coalesce(p_profile ->> 'injury_history', injury_history)
   where id = v_client_id;

  update onboarding_invites set accepted_at = now() where id = v_invite_id;

  return v_client_id;
end$$;

revoke all on function public.invite_submit(text, jsonb) from public;
grant execute on function public.invite_submit(text, jsonb) to anon, authenticated;
