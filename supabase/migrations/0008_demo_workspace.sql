-- ============================================================================
-- 0008 · Demo workspace
-- Every business row belongs to a workspace: 'live' (the real company) or
-- 'demo' (the sandbox shown to prospects through demo@flowstate.com).
--
-- Isolation is enforced by ONE restrictive policy per table — the
-- "workspace fence". Restrictive policies are AND-ed with every permissive
-- one, so a sloppy policy added later (or an old migration re-run) still can't
-- show live rows to the demo account, or anything at all to a stray signup.
--
-- New tables in later migrations add the same column + fence.
-- Requires: 0007
-- ============================================================================

-- ───────────────────────────── workspaces ──────────────────────────────────
create table if not exists public.workspaces (
  id            text primary key check (id in ('live', 'demo')),
  name          text not null,
  demo_reset_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.workspaces is
  'The two data spaces. Later migrations hang per-workspace settings off this row.';

insert into public.workspaces (id, name) values
  ('live', 'Flow State'),
  ('demo', 'Demo workspace')
on conflict (id) do nothing;

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

-- ─────────────────────── profile workspace + helper ─────────────────────────
alter table public.profiles
  add column if not exists workspace text not null default 'live' references public.workspaces (id);

-- The caller's workspace; 'live' for anon and the service role.
create or replace function public.current_workspace()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.workspace from public.profiles p where p.id = auth.uid()), 'live');
$$;

revoke execute on function public.current_workspace() from public, anon, authenticated;
grant execute on function public.current_workspace() to authenticated, service_role;

-- ──────────────── access helpers now understand workspaces ──────────────────
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
      and private.role_allows(p.role, p.permissions, p.workspace, p.is_active, p_module)
  );
$$;

-- Someone else, in MY workspace — the demo can never tag or notify live users.
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
      and p.workspace = public.current_workspace()
      and private.role_allows(p.role, p.permissions, p.workspace, p.is_active, p_module)
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
    where id = auth.uid() and is_active and role = 'super_admin' and workspace = 'live'
  );
$$;

revoke execute on function public.can_access(text), public.user_can_access(uuid, text), public.is_super_admin()
  from public, anon, authenticated;
grant execute on function public.can_access(text), public.user_can_access(uuid, text), public.is_super_admin()
  to authenticated, service_role;

-- ───────────────────── workspace column on 0001–0006 ────────────────────────
-- Backfilled 'live', then defaulted to the caller's workspace. Inquiries keep
-- a constant 'live' default: only the public form writes them.
do $$
declare
  t text;
begin
  foreach t in array array[
    'inquiries', 'pipeline_stages', 'leads', 'lead_activities',
    'finance_entries', 'calendar_events', 'email_states'
  ] loop
    execute format(
      'alter table public.%I add column if not exists workspace text not null default %L references public.workspaces (id)',
      t, 'live'
    );
    execute format('create index if not exists %I on public.%I (workspace)', t || '_workspace_idx', t);
    if t <> 'inquiries' then
      execute format('alter table public.%I alter column workspace set default public.current_workspace()', t);
    end if;
  end loop;
end $$;

-- Pipeline slugs are unique per workspace now — the demo has its own board.
alter table public.pipeline_stages drop constraint if exists pipeline_stages_slug_key;
create unique index if not exists pipeline_stages_workspace_slug_idx
  on public.pipeline_stages (workspace, slug);

-- ───────────────────────────── the fence ───────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'inquiries', 'pipeline_stages', 'leads', 'lead_activities',
    'finance_entries', 'calendar_events', 'email_states'
  ] loop
    execute format('drop policy if exists "workspace fence" on public.%I', t);
    execute format(
      'create policy "workspace fence" on public.%I as restrictive for all to authenticated
         using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
         with check (workspace = (select public.current_workspace()) and (select public.is_active_member()))',
      t
    );
  end loop;
end $$;

-- The public form can only ever write into the live workspace.
drop policy if exists "inquiries: public can submit" on public.inquiries;
create policy "inquiries: public can submit"
  on public.inquiries for insert to anon
  with check (workspace = 'live' and status = 'new' and converted_lead_id is null);

-- ───────────────────────── workspaces table access ─────────────────────────
alter table public.workspaces enable row level security;

drop policy if exists "workspaces: read own" on public.workspaces;
create policy "workspaces: read own"
  on public.workspaces for select to authenticated
  using (id = (select public.current_workspace()) and (select public.is_active_member()));

drop policy if exists "workspaces: admins update own" on public.workspaces;
create policy "workspaces: admins update own"
  on public.workspaces for update to authenticated
  using (id = (select public.current_workspace()) and (select public.is_admin()))
  with check (id = (select public.current_workspace()) and (select public.is_admin()));

revoke insert, delete on public.workspaces from anon, authenticated;
revoke all on public.workspaces from anon;

-- ───────────── profile guard also locks the workspace column ────────────────
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
       or new.email is distinct from old.email
       or new.workspace is distinct from old.workspace then
      raise exception 'Only the super admin can change roles and access.' using errcode = '42501';
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.role = 'super_admin' and old.is_active and old.workspace = 'live'
     and (tg_op = 'DELETE' or new.role <> 'super_admin' or not new.is_active or new.workspace <> 'live') then
    if not exists (
      select 1 from public.profiles p
      where p.role = 'super_admin' and p.is_active and p.workspace = 'live' and p.id <> old.id
    ) then
      raise exception 'Flow State needs at least one active super admin.' using errcode = 'check_violation';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ──────────────── stage-change trail inherits the lead's workspace ──────────
create or replace function public.log_lead_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  from_name text;
  to_name   text;
begin
  -- The legacy import copies the original trail itself.
  if private.flag('importing') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select name into to_name from public.pipeline_stages where id = new.stage_id;
    insert into public.lead_activities (lead_id, kind, body, actor_id, workspace)
    values (new.id, 'created', format('Lead created in %s', coalesce(to_name, 'pipeline')), auth.uid(), new.workspace);
    return new;
  end if;

  if new.stage_id is distinct from old.stage_id then
    select name into from_name from public.pipeline_stages where id = old.stage_id;
    select name into to_name   from public.pipeline_stages where id = new.stage_id;
    insert into public.lead_activities (lead_id, kind, body, actor_id, workspace)
    values (new.id, 'stage', format('%s → %s', coalesce(from_name, '—'), coalesce(to_name, '—')), auth.uid(), new.workspace);
  end if;

  return new;
end;
$$;

revoke execute on function public.log_lead_stage_change() from public, anon, authenticated;

-- ──────────────────────────── new accounts ──────────────────────────────────
-- The first live account of a fresh project becomes the super admin; every
-- later one is a viewer until Team & Users sets it up. Demo accounts (flagged
-- in app_metadata, which only the service role can write) are born inside the
-- demo workspace and can never win the "first user" race.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_demo  boolean := coalesce((new.raw_app_meta_data ->> 'demo')::boolean, false);
  is_first boolean;
begin
  lock table public.profiles in exclusive mode;

  select not exists (select 1 from public.profiles where workspace = 'live') into is_first;

  insert into public.profiles (id, email, full_name, role, workspace)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
    case when not is_demo and is_first then 'super_admin' else 'viewer' end,
    case when is_demo then 'demo' else 'live' end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
