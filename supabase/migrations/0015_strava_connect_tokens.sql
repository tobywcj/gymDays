-- ============================================================================
-- M6.1 — Client-facing Strava connect links
-- Trainer mints a token, sends the public URL /connect/strava/<token> to the
-- client via Telegram/email. Client opens it on their device, completes the
-- real Strava OAuth handshake (only the athlete can authorize their own
-- account), and our callback writes the tokens.
-- ============================================================================

create table if not exists strava_connect_tokens (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_strava_connect_tokens_token on strava_connect_tokens(token);

alter table strava_connect_tokens enable row level security;
drop policy if exists strava_connect_tokens_owner on strava_connect_tokens;
create policy strava_connect_tokens_owner on strava_connect_tokens
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

-- Public lookup (anon) — returns client info IFF the token is live.
create or replace function public.strava_connect_lookup(p_token text)
returns table (client_id uuid, client_name text, trainer_name text, expires_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select c.id, c.name, t.full_name, k.expires_at
  from strava_connect_tokens k
  join clients c  on c.id = k.client_id
  join trainers t on t.id = k.trainer_id
  where k.token = p_token
    and k.used_at is null
    and k.expires_at > now()
$$;

revoke all on function public.strava_connect_lookup(text) from public;
grant execute on function public.strava_connect_lookup(text) to anon, authenticated;

-- Public consume — marks token used and returns trainer_id + client_id.
-- Service-role only; called from /api/strava/prepare-public.
create or replace function public.strava_connect_consume(p_token text)
returns table (client_id uuid, trainer_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_trainer_id uuid;
begin
  select k.client_id, k.trainer_id
    into v_client_id, v_trainer_id
  from strava_connect_tokens k
  where k.token = p_token
    and k.used_at is null
    and k.expires_at > now()
  for update;

  if v_client_id is null then
    raise exception 'token_invalid' using errcode = '22023';
  end if;

  update strava_connect_tokens set used_at = now() where token = p_token;
  return query select v_client_id, v_trainer_id;
end$$;

revoke all on function public.strava_connect_consume(text) from public;
grant execute on function public.strava_connect_consume(text) to service_role;
