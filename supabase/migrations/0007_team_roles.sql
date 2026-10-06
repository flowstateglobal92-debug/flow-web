-- ============================================================================
-- 0007 · Team & roles
-- Turns the single-admin control room into a team:
--   super_admin — everything, including Team & Users (the old 'admin')
--   admin       — everything except Team & Users
--   member      — only the modules ticked in profiles.permissions
--   viewer      — no access (anyone not created through Team & Users)
--
-- Also introduces the `private` schema: helpers that only triggers and
-- definer functions call. PostgREST never exposes it and nobody is granted
-- anything on it, so none of it is reachable as an RPC.
--
-- Supabase grants EXECUTE on every new public function to anon and
-- authenticated by default; every function below is revoked and re-granted
-- explicitly.
-- Requires: 0001–0006
-- ============================================================================

create schema if not exists private;
revoke all on schema private from public;
-- Postgres can't revoke the global "EXECUTE to PUBLIC" default per schema, so
-- each migration revokes its own private functions explicitly (0010 sweeps
-- 0007–0010's). Without USAGE on the schema they were never reachable anyway.

-- ──────────────────────── 1. role values + backfill ─────────────────────────
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('super_admin', 'admin', 'member', 'viewer'));

-- The original admin becomes the super admin. Guarded so that re-running this
-- file later can never promote ordinary admins created since.
update public.profiles
set role = 'super_admin'
where role = 'admin'
  and not exists (select 1 from public.profiles where role = 'super_admin');

-- ─────────────────────────── 2. profile columns ─────────────────────────────
alter table public.profiles add column if not exists permissions text[] not null default '{}';
alter table public.profiles add column if not exists is_active boolean not null default true;
alter table public.profiles add column if not exists title text;

alter table public.profiles drop constraint if exists profiles_permissions_check;
alter table public.profiles
  add constraint profiles_permissions_check check (
    permissions <@ array[
      'dashboard', 'inquiries', 'email', 'crm', 'clients', 'invoices',
      'finance', 'reports', 'calendar', 'todos', 'workload'
    ]::text[]
  );

comment on column public.profiles.permissions is
  'Module keys a member may open. Ignored for super_admin/admin (they have everything).';

-- ─────────────────────────────── 3. helpers ─────────────────────────────────
-- The one access rule, used by every check below so SQL and the app agree.
-- Mirrored in src/lib/admin/modules.ts → canAccess().
create or replace function private.role_allows(
  p_role text, p_permissions text[], p_workspace text, p_active boolean, p_module text
)
returns boolean
language sql
immutable
as $$
  select coalesce(p_active, false)
     and not (p_workspace = 'demo' and p_module = 'email')
     and (
          (p_role = 'super_admin' and p_workspace = 'live')
       or (p_role = 'admin' and (p_module <> 'team' or p_workspace = 'demo'))
       or (p_role = 'member' and p_module <> 'team' and p_module = any (coalesce(p_permissions, '{}')))
     );
$$;

-- Transaction-local switches set by trusted code paths (import, seed, batch
-- saves). Users can't set flowstate.* settings through the API.
create or replace function private.flag(p_name text)
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('flowstate.' || p_name, true), '') = 'on';
$$;

-- Active super_admin / admin / member — the baseline for every policy.
create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role in ('super_admin', 'admin', 'member')
  );
$$;

-- Back-compat name; now means "can approve and override": super_admin or admin.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role in ('super_admin', 'admin')
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role = 'super_admin'
  );
$$;

create or replace function public.can_access(p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and private.role_allows(p.role, p.permissions, 'live', p.is_active, p_module)
  );
$$;

-- Same rule for someone else — used to filter assignees, mentions, recipients.
create or replace function public.user_can_access(p_user uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user
      and private.role_allows(p.role, p.permissions, 'live', p.is_active, p_module)
  );
$$;

revoke execute on function public.is_active_member(), public.is_admin(), public.is_super_admin(),
  public.can_access(text), public.user_can_access(uuid, text)
  from public, anon, authenticated;
grant execute on function public.is_active_member(), public.is_admin(), public.is_super_admin(),
  public.can_access(text), public.user_can_access(uuid, text)
  to authenticated, service_role;

-- Hygiene on the functions 0001–0003 shipped with Supabase's default grants.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.guard_protected_stage() from public, anon, authenticated;
revoke execute on function public.log_lead_stage_change() from public, anon, authenticated;
revoke execute on function public.delete_pipeline_stage(uuid, uuid) from public, anon;
grant execute on function public.delete_pipeline_stage(uuid, uuid) to authenticated;

-- ────────────────────── 4. created_by can't be forged ───────────────────────
-- From the API the creator is always the caller and never changes afterwards.
-- Trusted paths (definer functions, the service role, the seed) may set it —
-- including the foreign key's own `on delete set null` when an account is
-- deleted, which runs as the table owner. Freezing that too would make every
-- account that ever created a row impossible to delete.
create or replace function private.stamp_created_by()
returns trigger
language plpgsql
security invoker
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'anon') then
      new.created_by := auth.uid();
    else
      new.created_by := coalesce(new.created_by, auth.uid());
    end if;
  elsif current_user in ('authenticated', 'anon') then
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create or replace function private.stamp_actor_id()
returns trigger
language plpgsql
security invoker
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'anon') then
      new.actor_id := auth.uid();
    else
      new.actor_id := coalesce(new.actor_id, auth.uid());
    end if;
  elsif current_user in ('authenticated', 'anon') then
    new.actor_id := old.actor_id;
  end if;
  return new;
end;
$$;

drop trigger if exists leads_stamp_created_by on public.leads;
create trigger leads_stamp_created_by
  before insert or update on public.leads
  for each row execute function private.stamp_created_by();

drop trigger if exists finance_entries_stamp_created_by on public.finance_entries;
create trigger finance_entries_stamp_created_by
  before insert or update on public.finance_entries
  for each row execute function private.stamp_created_by();

drop trigger if exists calendar_events_stamp_created_by on public.calendar_events;
create trigger calendar_events_stamp_created_by
  before insert or update on public.calendar_events
  for each row execute function private.stamp_created_by();

drop trigger if exists lead_activities_stamp_actor on public.lead_activities;
create trigger lead_activities_stamp_actor
  before insert or update on public.lead_activities
  for each row execute function private.stamp_actor_id();

-- ─────────────────── 5. drop every legacy is_admin() policy ─────────────────
drop policy if exists "profiles: read own" on public.profiles;
drop policy if exists "profiles: admin reads all" on public.profiles;
drop policy if exists "profiles: update own name" on public.profiles;
drop policy if exists "profiles: admin manages all" on public.profiles;
drop policy if exists "inquiries: admin manages" on public.inquiries;
drop policy if exists "stages: admin manages" on public.pipeline_stages;
drop policy if exists "leads: admin manages" on public.leads;
drop policy if exists "lead activities: admin manages" on public.lead_activities;
drop policy if exists "finance: admin manages" on public.finance_entries;
drop policy if exists "calendar: admin manages" on public.calendar_events;
drop policy if exists "email: admin manages" on public.email_states;

-- ──────────────────────── 6. module policies ────────────────────────────────
drop policy if exists "inquiries: module" on public.inquiries;
create policy "inquiries: module"
  on public.inquiries for all to authenticated
  using ((select public.can_access('inquiries')))
  with check ((select public.can_access('inquiries')));

-- The public form posts as anon. Insert only, and only a fresh inquiry —
-- the caller can't pre-set status or a CRM link. (0008 adds the workspace.)
drop policy if exists "inquiries: public can submit" on public.inquiries;
create policy "inquiries: public can submit"
  on public.inquiries for insert to anon
  with check (status = 'new' and converted_lead_id is null);

drop policy if exists "stages: module" on public.pipeline_stages;
create policy "stages: module"
  on public.pipeline_stages for all to authenticated
  using ((select public.can_access('crm')))
  with check ((select public.can_access('crm')));

drop policy if exists "leads: module" on public.leads;
create policy "leads: module"
  on public.leads for all to authenticated
  using ((select public.can_access('crm')))
  with check ((select public.can_access('crm')));

drop policy if exists "lead activities: module" on public.lead_activities;
create policy "lead activities: module"
  on public.lead_activities for all to authenticated
  using ((select public.can_access('crm')))
  with check ((select public.can_access('crm')));

drop policy if exists "finance: module" on public.finance_entries;
create policy "finance: module"
  on public.finance_entries for all to authenticated
  using ((select public.can_access('finance')))
  with check ((select public.can_access('finance')));

drop policy if exists "calendar: module" on public.calendar_events;
create policy "calendar: module"
  on public.calendar_events for all to authenticated
  using ((select public.can_access('calendar')))
  with check ((select public.can_access('calendar')));

drop policy if exists "email: module" on public.email_states;
create policy "email: module"
  on public.email_states for all to authenticated
  using ((select public.can_access('email')))
  with check ((select public.can_access('email')));

-- ─────────────────────────────── 7. profiles ────────────────────────────────
-- Teammates can see each other (needed to tag, assign and show avatars).
-- Everyone may edit their own name and title; nothing else. Accounts are
-- created, changed and removed only through the service role (Team & Users).
drop policy if exists "profiles: teammates read" on public.profiles;
create policy "profiles: teammates read"
  on public.profiles for select to authenticated
  using ((select public.is_active_member()));

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

revoke insert, update, delete on public.profiles from anon, authenticated;
revoke select on public.profiles from anon;
grant update (full_name, title) on public.profiles to authenticated;

-- ─────────────────── 8. first user of a fresh project ───────────────────────
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
    case when is_first then 'super_admin' else 'viewer' end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ───────────────────────────── 9. profile guard ─────────────────────────────
-- Invoker on purpose: current_user is the API role for REST calls and the
-- owner inside definer functions / the service role / the SQL editor.
create or replace function private.guard_profiles()
returns trigger
language plpgsql
security invoker
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op <> 'UPDATE' then
      raise exception 'Accounts are managed from Team & Users.' using errcode = '42501';
    end if;
    if new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.permissions is distinct from old.permissions
       or new.is_active is distinct from old.is_active
       or new.email is distinct from old.email then
      raise exception 'Only the super admin can change roles and access.' using errcode = '42501';
    end if;
  end if;

  -- Never leave the system without an active super admin.
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'super_admin' and old.is_active
     and (tg_op = 'DELETE' or new.role <> 'super_admin' or not new.is_active) then
    if not exists (
      select 1 from public.profiles p
      where p.role = 'super_admin' and p.is_active and p.id <> old.id
    ) then
      raise exception 'Flow State needs at least one active super admin.' using errcode = 'check_violation';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before insert or update or delete on public.profiles
  for each row execute function private.guard_profiles();
