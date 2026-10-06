-- ============================================================================
-- 0009 · Notifications
-- One row per alert per person. Rows are written only by triggers (through
-- private.notify) — the API can read its own, mark them read, and delete them.
--
-- Scheduled reminders need no cron: a row with a future deliver_at is hidden
-- by RLS until it's due. Realtime only pushes rows the subscriber can see, so
-- a reminder never arrives early; the app polls for the ones that mature.
--
-- Feature migrations add their own triggers. This one covers the tables that
-- already exist: a new inquiry, and a lead landing in a won stage.
-- Requires: 0008
-- ============================================================================

-- ──────────────────────────── time helpers ──────────────────────────────────
-- The business runs on Sri Lanka time; Postgres runs on UTC.
create or replace function public.local_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Colombo')::date;
$$;

revoke execute on function public.local_today() from public, anon;
grant execute on function public.local_today() to authenticated, service_role;

-- A wall-clock moment in Colombo → timestamptz.
create or replace function private.local_at(p_day date, p_time time)
returns timestamptz
language sql
immutable
as $$
  select (p_day + p_time) at time zone 'Asia/Colombo';
$$;

-- ─────────────────────────────── table ─────────────────────────────────────
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  workspace    text not null default public.current_workspace() references public.workspaces (id),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id     uuid references public.profiles (id) on delete set null,
  type         text not null,
  title        text not null,
  body         text,
  link         text check (link is null or link ~ '^/admin(/|\?|$)'),
  entity_type  text,
  entity_id    uuid,
  deliver_at   timestamptz not null default now(),
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.notifications is
  'In-app alerts. Written by triggers via private.notify(); deliver_at in the future = scheduled reminder.';

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, deliver_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (recipient_id) where read_at is null;
create index if not exists notifications_pending_entity_idx
  on public.notifications (entity_type, entity_id) where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists "workspace fence" on public.notifications;
create policy "workspace fence" on public.notifications as restrictive for all to authenticated
  using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
  with check (workspace = (select public.current_workspace()) and (select public.is_active_member()));

drop policy if exists "notifications: read own delivered" on public.notifications;
create policy "notifications: read own delivered"
  on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()) and deliver_at <= now());

drop policy if exists "notifications: mark own read" on public.notifications;
create policy "notifications: mark own read"
  on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

drop policy if exists "notifications: delete own" on public.notifications;
create policy "notifications: delete own"
  on public.notifications for delete to authenticated
  using (recipient_id = (select auth.uid()));

-- Table-level grants beat column grants, so revoke first. The API may only
-- flip read_at; inserts happen in triggers.
revoke all on public.notifications from anon;
revoke insert, update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Live delivery.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ─────────────────────────────── helpers ───────────────────────────────────
-- Active people in a workspace who may open a module.
create or replace function private.users_with_access(p_module text, p_workspace text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.profiles p
  where p.workspace = p_workspace
    and private.role_allows(p.role, p.permissions, p.workspace, p.is_active, p_module);
$$;

-- Active approvers (super admin / admin) in a workspace.
create or replace function private.admins_of(p_workspace text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.profiles p
  where p.workspace = p_workspace and p.is_active and p.role in ('super_admin', 'admin');
$$;

-- Fan one alert out to many people. Never notifies the actor, never notifies
-- anyone outside the workspace or inactive, and stays silent during imports
-- and the demo seed.
create or replace function private.notify(
  p_recipients  uuid[],
  p_workspace   text,
  p_type        text,
  p_title       text,
  p_body        text default null,
  p_link        text default null,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_deliver_at  timestamptz default now(),
  p_actor       uuid default auth.uid()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if private.flag('importing') or private.flag('seeding') then
    return;
  end if;

  insert into public.notifications
    (workspace, recipient_id, actor_id, type, title, body, link, entity_type, entity_id, deliver_at)
  select p_workspace, r, p_actor, p_type, left(p_title, 200), left(p_body, 500), p_link,
         p_entity_type, p_entity_id, coalesce(p_deliver_at, now())
  from (select distinct unnest(p_recipients) as r) rec
  join public.profiles p on p.id = rec.r
  where r is not null
    and r is distinct from p_actor
    and p.is_active
    and p.workspace = p_workspace;
end;
$$;

-- Drop not-yet-delivered alerts for an entity (before rescheduling them).
create or replace function private.clear_pending(p_entity_type text, p_entity_id uuid, p_types text[] default null)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.notifications
  where entity_type = p_entity_type
    and entity_id = p_entity_id
    and read_at is null
    and deliver_at > now()
    and (p_types is null or type = any (p_types));
$$;

-- Rs 1,250,000 — for alert copy.
create or replace function private.rupees(p_amount numeric)
returns text
language sql
immutable
as $$
  select 'Rs ' || to_char(round(coalesce(p_amount, 0)), 'FM999,999,999,990');
$$;

-- ─────────────────────── triggers on 0002 / 0003 ───────────────────────────
create or replace function private.notify_new_inquiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.notify(
    array(select private.users_with_access('inquiries', new.workspace)),
    new.workspace,
    'inquiry_new',
    format('New inquiry from %s', new.name),
    nullif(concat_ws(' · ', new.business, new.focus), ''),
    '/admin/inquiries?open=' || new.id,
    'inquiry', new.id,
    now(),
    null
  );
  return null;
end;
$$;

drop trigger if exists inquiries_notify_new on public.inquiries;
create trigger inquiries_notify_new
  after insert on public.inquiries
  for each row execute function private.notify_new_inquiry();

create or replace function private.notify_lead_won()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  won boolean;
  was_won boolean := false;
begin
  select is_won into won from public.pipeline_stages where id = new.stage_id;
  if tg_op = 'UPDATE' then
    select is_won into was_won from public.pipeline_stages where id = old.stage_id;
  end if;

  if coalesce(won, false) and not coalesce(was_won, false) then
    perform private.notify(
      array(select private.users_with_access('crm', new.workspace)),
      new.workspace,
      'lead_won',
      format('Deal won · %s', coalesce(new.company, new.name)),
      case when new.value > 0 then private.rupees(new.value) end,
      '/admin/crm?lead=' || new.id,
      'lead', new.id
    );
  end if;
  return null;
end;
$$;

drop trigger if exists leads_notify_won on public.leads;
create trigger leads_notify_won
  after insert or update of stage_id on public.leads
  for each row execute function private.notify_lead_won();
