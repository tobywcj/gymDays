-- ============================================================================
-- M3 — Auth integration
-- When a new auth.users row is created (signup, admin-create, magic link
-- confirm), automatically materialise a `trainers` row with the same id.
-- This is the canonical Supabase pattern for "1 auth user = 1 app row".
--
-- On LOCAL postgres there is no auth.users table — the trigger creation is
-- skipped so the migration stays idempotent across environments.
-- ============================================================================

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

  -- Function that mirrors auth.users → public.trainers
  execute $f$
    create or replace function public.handle_new_auth_user()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $body$
    begin
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

  -- Recreate the trigger so re-running the migration is idempotent
  execute 'drop trigger if exists on_auth_user_created on auth.users';
  execute $f$
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_auth_user()
  $f$;
end$$;

-- Backfill: any auth users that already exist but lack a trainers row
-- (idempotent — `on conflict do nothing`).
do $$
begin
  if exists(select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'users') then
    execute $f$
      insert into public.trainers (id, email, full_name)
      select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1))
      from auth.users u
      left join public.trainers t on t.id = u.id
      where t.id is null
      on conflict (id) do nothing
    $f$;
  end if;
end$$;
