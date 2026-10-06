-- ============================================================================
-- 0012 · Record ownership
-- Every lead has an owner and every client an account manager, so the CRM and
-- the client list can offer "Mine" and the workload view can count who
-- carries what. Ownership is a responsibility, not a lock: anyone who may edit
-- the record may still reassign it.
--
--   leads.owner_id              — defaults to whoever creates the lead
--   clients.account_manager_id  — defaults to whoever creates the client
--
-- Existing rows are backfilled from created_by, once, when the column first
-- appears (re-running this file never re-assigns a deliberately unowned row).
-- From the API, an owner must be someone who can open the module (and so sits
-- in the caller's workspace); the new owner hears about it through the bell.
-- Requires: 0011
-- ============================================================================

-- ──────────────────────── columns + one-time backfill ───────────────────────
-- The backfill is housekeeping, not an edit: the activity log is muted with the
-- import flag and updated_at is left alone.
do $$
declare
  prev text := current_setting('flowstate.importing', true);
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leads' and column_name = 'owner_id'
  ) then
    alter table public.leads
      add column owner_id uuid references public.profiles (id) on delete set null;

    perform set_config('flowstate.importing', 'on', true);
    alter table public.leads disable trigger leads_set_updated_at;
    update public.leads l
    set owner_id = l.created_by
    where l.owner_id is null
      and exists (select 1 from public.profiles p where p.id = l.created_by and p.workspace = l.workspace);
    alter table public.leads enable trigger leads_set_updated_at;
    perform set_config('flowstate.importing', coalesce(prev, ''), true);
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name = 'account_manager_id'
  ) then
    alter table public.clients
      add column account_manager_id uuid references public.profiles (id) on delete set null;

    perform set_config('flowstate.importing', 'on', true);
    alter table public.clients disable trigger clients_set_updated_at;
    update public.clients c
    set account_manager_id = c.created_by
    where c.account_manager_id is null
      and exists (select 1 from public.profiles p where p.id = c.created_by and p.workspace = c.workspace);
    alter table public.clients enable trigger clients_set_updated_at;
    perform set_config('flowstate.importing', coalesce(prev, ''), true);
  end if;
end $$;

comment on column public.leads.owner_id is
  'Who is working the lead. Defaults to the creator; must have CRM access when set from the app.';
comment on column public.clients.account_manager_id is
  'Who looks after the client. Defaults to the creator; must have Clients access when set from the app.';

create index if not exists leads_owner_idx on public.leads (owner_id);
create index if not exists clients_account_manager_idx on public.clients (account_manager_id);

-- ─────────────────────── default owner + access check ───────────────────────
-- tg_argv[0] = owner column, tg_argv[1] = module the owner must be able to open.
-- Invoker on purpose (see private.guard_profiles): current_user tells API
-- calls apart from trusted ones, and only API calls are checked. Trusted
-- inserts with no caller (imports, the service role) fall back to created_by
-- when that person belongs to the row's workspace.
create or replace function private.stamp_owner()
returns trigger
language plpgsql
security invoker
as $$
declare
  col      text := tg_argv[0];
  module   text := tg_argv[1];
  given    uuid := (to_jsonb(new) ->> col)::uuid;
  assignee uuid := given;
  who      text;
begin
  if tg_op = 'INSERT' then
    assignee := coalesce(
      given,
      auth.uid(),
      (select p.id from public.profiles p
        where p.id = (to_jsonb(new) ->> 'created_by')::uuid and p.workspace = new.workspace)
    );
    if assignee is distinct from given then
      new := jsonb_populate_record(new, jsonb_build_object(col, assignee));
    end if;
  elsif assignee is not distinct from (to_jsonb(old) ->> col)::uuid then
    return new;
  end if;

  -- Taking a record yourself is covered by the table's own policies.
  if assignee is not null
     and assignee is distinct from auth.uid()
     and current_user in ('authenticated', 'anon')
     and not public.user_can_access(assignee, module) then
    select coalesce(nullif(p.full_name, ''), p.email) into who from public.profiles p where p.id = assignee;
    raise exception '% doesn''t have access to %.',
      coalesce(who, 'That person'),
      case module when 'crm' then 'the CRM' else initcap(module) end
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.stamp_owner() from public, anon, authenticated;

drop trigger if exists leads_stamp_owner on public.leads;
create trigger leads_stamp_owner
  before insert or update of owner_id on public.leads
  for each row execute function private.stamp_owner('owner_id', 'crm');

drop trigger if exists clients_stamp_account_manager on public.clients;
create trigger clients_stamp_account_manager
  before insert or update of account_manager_id on public.clients
  for each row execute function private.stamp_owner('account_manager_id', 'clients');

-- ──────────────────────────── notifications ─────────────────────────────────
-- The new owner hears about it — unless they assigned themselves (notify skips
-- the actor), created the record, or can't open the module (trusted paths may
-- set anyone).
create or replace function private.notify_lead_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is null
     or (tg_op = 'INSERT' and new.owner_id is not distinct from new.created_by)
     or (tg_op = 'UPDATE' and new.owner_id is not distinct from old.owner_id) then
    return null;
  end if;

  perform private.notify(
    array(select u from private.users_with_access('crm', new.workspace) u where u = new.owner_id),
    new.workspace,
    'lead_assigned',
    format('Lead assigned to you · %s', coalesce(nullif(new.company, ''), new.name)),
    nullif(concat_ws(' · ',
      case when nullif(new.company, '') is not null then new.name end,
      case when new.value > 0 then private.rupees(new.value) end
    ), ''),
    '/admin/crm?lead=' || new.id,
    'lead', new.id
  );
  return null;
end;
$$;

revoke execute on function private.notify_lead_assigned() from public, anon, authenticated;

drop trigger if exists leads_notify_assigned on public.leads;
create trigger leads_notify_assigned
  after insert or update of owner_id on public.leads
  for each row execute function private.notify_lead_assigned();

create or replace function private.notify_client_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_manager_id is null
     or (tg_op = 'INSERT' and new.account_manager_id is not distinct from new.created_by)
     or (tg_op = 'UPDATE' and new.account_manager_id is not distinct from old.account_manager_id) then
    return null;
  end if;

  perform private.notify(
    array(select u from private.users_with_access('clients', new.workspace) u where u = new.account_manager_id),
    new.workspace,
    'client_assigned',
    format('Client assigned to you · %s', new.name),
    nullif(concat_ws(' · ', nullif(nullif(new.company, ''), new.name), nullif(new.email, '')), ''),
    '/admin/clients/' || new.id,
    'client', new.id
  );
  return null;
end;
$$;

revoke execute on function private.notify_client_assigned() from public, anon, authenticated;

drop trigger if exists clients_notify_assigned on public.clients;
create trigger clients_notify_assigned
  after insert or update of account_manager_id on public.clients
  for each row execute function private.notify_client_assigned();
