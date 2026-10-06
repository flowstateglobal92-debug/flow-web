-- ============================================================================
-- 0001 · Admin auth
-- Profiles mirrored from auth.users, with the FIRST account to exist becoming
-- the admin. Every later signup lands as 'viewer' and has to be promoted by
-- an admin. Also ships the two helpers the rest of the schema leans on:
--   public.is_admin()        — RLS predicate used by every admin-only table
--   public.set_updated_at()  — shared updated_at trigger function
-- ============================================================================

-- ─────────────────────────── shared helpers ────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ───────────────────────────── profiles ────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text not null default 'viewer' check (role in ('admin', 'viewer')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Application profile for each auth user. The first account created becomes admin.';

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ─────────────────── first user becomes the admin ──────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first boolean;
begin
  -- Serialise concurrent signups so exactly one row can win the "first" check.
  lock table public.profiles in exclusive mode;

  select not exists (select 1 from public.profiles) into is_first;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
    case when is_first then 'admin' else 'viewer' end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: if the admin account was created in the Supabase dashboard BEFORE
-- this migration ran, the trigger never fired. Mirror any existing users and
-- make the earliest one the admin.
insert into public.profiles (id, email, full_name, role, created_at)
select
  u.id,
  coalesce(u.email, ''),
  nullif(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'), ''),
  case
    when u.id = (select u2.id from auth.users u2 order by u2.created_at asc, u2.id asc limit 1)
      then 'admin'
    else 'viewer'
  end,
  u.created_at
from auth.users u
on conflict (id) do nothing;

-- Safety net: a database with users but no admin (e.g. the first profile was
-- deleted) promotes its earliest profile rather than locking everyone out.
-- 0007 renames the top role to super_admin, so either counts as "has an admin".
update public.profiles
set role = 'admin'
where not exists (select 1 from public.profiles where role in ('admin', 'super_admin'))
  and id = (select id from public.profiles order by created_at asc, id asc limit 1);

-- ─────────────────────────── is_admin() ────────────────────────────────────
-- security definer so RLS policies can call it without recursing into the
-- profiles policies themselves.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.is_admin() to authenticated;

-- ───────────────────────────── policies ────────────────────────────────────
alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "profiles: admin reads all" on public.profiles;
create policy "profiles: admin reads all"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

drop policy if exists "profiles: update own name" on public.profiles;
create policy "profiles: update own name"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select p.role from public.profiles p where p.id = auth.uid()));

drop policy if exists "profiles: admin manages all" on public.profiles;
create policy "profiles: admin manages all"
  on public.profiles for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
