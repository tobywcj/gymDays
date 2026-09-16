-- ============================================================================
-- Client-side auth — give clients (trainees) their own logged-in portal.
--
-- Until now every auth user became a TRAINER (handle_new_auth_user always
-- inserted a trainers row). This migration:
--   1. Links an auth user to their client row(s) via clients.auth_user_id.
--   2. Reworks the new-user trigger so a sign-in whose email matches an
--      existing client links them as a CLIENT instead of minting a trainer.
--   3. Adds read-only RLS so a client can see ONLY their own data and can
--      never edit/override it (no client-side INSERT/UPDATE/DELETE policies).
--
-- A client may train under more than one trainer, so auth_user_id is NOT
-- unique — one auth user can map to several client rows.
-- ============================================================================

-- ─── 1. Link column ─────────────────────────────────────────────────────────
-- No FK to auth.users on purpose (mirrors trainers.id): keeps the migration
-- runnable on local Postgres where auth.users doesn't exist.
alter table clients add column if not exists auth_user_id uuid;
create index if not exists idx_clients_auth_user on clients(auth_user_id);

-- ─── 2. New-user trigger: client-aware ──────────────────────────────────────
do $$
declare
  has_users boolean;
begin
  select exists(
    select 1 from information_schema.tables
    where table_schema = 'auth' and table_name = 'users'
  ) into has_users;

  if not has_users then
    raise notice 'auth.users not present (local Postgres) — skipping trigger';
    return;
  end if;

  execute $f$
    create or replace function public.handle_new_auth_user()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      v_linked integer;
    begin
      -- If this email already belongs to one or more client rows, claim them
      -- for this auth user and stop — they are a client, not a trainer.
      update public.clients
         set auth_user_id = new.id
       where auth_user_id is null
         and lower(email) = lower(new.email);
      get diagnostics v_linked = row_count;
      if v_linked > 0 then
        return new;
      end if;

      -- Otherwise mint a trainer as before.
      insert into public.trainers (id, email, full_name)
      values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
      )
      on conflict (id) do nothing;
      return new;
    end;
    $body$;
  $f$;

  execute 'drop trigger if exists on_auth_user_created on auth.users';
  execute $f$
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_auth_user()
  $f$;
end$$;

-- Backfill: link existing clients to existing auth users by email.
do $$
begin
  if exists(select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'users') then
    execute $f$
      update public.clients c
         set auth_user_id = u.id
        from auth.users u
       where c.auth_user_id is null
         and lower(c.email) = lower(u.email)
    $f$;
  end if;
end$$;

-- ─── 3. Client-scoped READ-ONLY RLS ─────────────────────────────────────────
-- Postgres combines permissive policies with OR, so these sit alongside the
-- existing `*_owner` (trainer) policies. A client user fails every `_owner`
-- check (trainer_id <> auth.uid()), so these SELECT policies are their ONLY
-- access — and there are deliberately no client INSERT/UPDATE/DELETE policies,
-- which makes the whole portal read-only at the database level.

-- Helper predicate inlined per table: the row's client belongs to this user.
-- clients: a client can read their own row(s).
drop policy if exists clients_self_read on clients;
create policy clients_self_read on clients
  for select to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists programs_client_read on programs;
create policy programs_client_read on programs
  for select to authenticated
  using (client_id in (select id from clients where auth_user_id = auth.uid()));

drop policy if exists meal_plans_client_read on meal_plans;
create policy meal_plans_client_read on meal_plans
  for select to authenticated
  using (client_id in (select id from clients where auth_user_id = auth.uid()));

drop policy if exists workouts_client_read on workouts;
create policy workouts_client_read on workouts
  for select to authenticated
  using (client_id in (select id from clients where auth_user_id = auth.uid()));

drop policy if exists activities_client_read on activities;
create policy activities_client_read on activities
  for select to authenticated
  using (client_id in (select id from clients where auth_user_id = auth.uid()));

drop policy if exists messages_client_read on messages;
create policy messages_client_read on messages
  for select to authenticated
  using (client_id in (select id from clients where auth_user_id = auth.uid()));

drop policy if exists progress_reports_client_read on progress_reports;
create policy progress_reports_client_read on progress_reports
  for select to authenticated
  using (client_id in (select id from clients where auth_user_id = auth.uid()));
