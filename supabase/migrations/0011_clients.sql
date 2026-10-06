-- ============================================================================
-- 0011 · Clients
-- The accounts the business actually bills: one row per client, shared by the
-- CRM (a won lead becomes a client), Invoices (bill-to), the calendar and
-- to-dos. Leads and calendar events can point at a client.
--
-- Only people with the Clients module may create, edit or delete a client,
-- but everyone whose screens offer a client picker (Invoices, CRM, Calendar,
-- To-dos) may read the list — otherwise the picker would be empty for them.
--
-- A link to a client must stay inside its own workspace: foreign keys are
-- checked without RLS, so without the link guard below a demo row could point
-- at a live client (or the reverse) just by knowing its id.
-- Requires: 0010
-- ============================================================================

-- ─────────────────────────────── table ─────────────────────────────────────
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  workspace   text not null default public.current_workspace() references public.workspaces (id),
  name        text not null,
  company     text,
  email       text,
  phone       text,
  address     text,
  city        text,
  country     text default 'Sri Lanka',
  tax_id      text,
  website     text,
  notes       text,
  status      text not null default 'active',
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.clients is
  'Client accounts. Readable from every module with a client picker; editable with the Clients module.';

alter table public.clients drop constraint if exists clients_status_check;
alter table public.clients
  add constraint clients_status_check check (status in ('active', 'prospect', 'archived'));

alter table public.clients drop constraint if exists clients_name_check;
alter table public.clients
  add constraint clients_name_check check (btrim(name) <> '');

create index if not exists clients_workspace_idx on public.clients (workspace);
create index if not exists clients_workspace_name_idx on public.clients (workspace, name);

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

drop trigger if exists clients_stamp_created_by on public.clients;
create trigger clients_stamp_created_by
  before insert or update on public.clients
  for each row execute function private.stamp_created_by();

-- ───────────────────────────── policies ────────────────────────────────────
alter table public.clients enable row level security;

drop policy if exists "workspace fence" on public.clients;
create policy "workspace fence" on public.clients as restrictive for all to authenticated
  using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
  with check (workspace = (select public.current_workspace()) and (select public.is_active_member()));

drop policy if exists "clients: module" on public.clients;
create policy "clients: module"
  on public.clients for all to authenticated
  using ((select public.can_access('clients')))
  with check ((select public.can_access('clients')));

-- Read-only for the modules that pick a client (bill-to, lead, event, to-do).
drop policy if exists "clients: pickers read" on public.clients;
create policy "clients: pickers read"
  on public.clients for select to authenticated
  using (
    (select public.can_access('invoices'))
    or (select public.can_access('crm'))
    or (select public.can_access('calendar'))
    or (select public.can_access('todos'))
  );

revoke all on public.clients from anon;

-- ─────────────────────── links from leads and events ────────────────────────
alter table public.leads
  add column if not exists client_id uuid references public.clients (id) on delete set null;
alter table public.calendar_events
  add column if not exists client_id uuid references public.clients (id) on delete set null;

create index if not exists leads_client_idx on public.leads (client_id);
create index if not exists calendar_events_client_idx on public.calendar_events (client_id);

-- Invoker on purpose: an API caller can only link a client they can see (the
-- clients policies + fence), and the client must share the row's workspace.
-- Trusted paths bypass RLS but still can't cross workspaces. Later tables with
-- a client_id (invoices, to-dos) can attach the same trigger.
create or replace function private.guard_client_link()
returns trigger
language plpgsql
security invoker
as $$
begin
  if new.client_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.client_id is not distinct from old.client_id
     and new.workspace is not distinct from old.workspace then
    return new;
  end if;

  if not exists (
    select 1 from public.clients c
    where c.id = new.client_id and c.workspace = new.workspace
  ) then
    raise exception 'That client doesn''t exist in this workspace.' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_client_link() from public, anon, authenticated;

drop trigger if exists leads_guard_client on public.leads;
create trigger leads_guard_client
  before insert or update of client_id, workspace on public.leads
  for each row execute function private.guard_client_link();

drop trigger if exists calendar_events_guard_client on public.calendar_events;
create trigger calendar_events_guard_client
  before insert or update of client_id, workspace on public.calendar_events
  for each row execute function private.guard_client_link();

-- ───────────────────────────── activity log ────────────────────────────────
drop trigger if exists clients_activity on public.clients;
create trigger clients_activity
  after insert or update or delete on public.clients
  for each row execute function private.log_activity('client', 'name', '{}');
