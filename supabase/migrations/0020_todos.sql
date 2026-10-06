-- ============================================================================
-- 0020 · To-dos
-- Tasks and reminders for the team: due dates (timed or all-day), a reminder
-- time, priority, labels, a checklist, links to a lead / client / invoice,
-- and the people tagged on it. Tagging someone puts the to-do on their
-- calendar and in their bell.
--
-- Who sees what:
--   · everyone with To-dos sees the workspace's to-dos — except private ones,
--     which only their participants (the creator and the assignees) see;
--   · the creator, an assignee or an admin may edit; the creator or an admin
--     may delete. Assignees and checklist steps follow their to-do.
--   · only people who can open To-dos can be tagged.
-- is_todo_participant() is a definer helper so the to-do policies can ask
-- "am I on it?" without reading todo_assignees through its own policies
-- (which look back at todos) — no recursion.
--
-- Repeating to-dos: completing one spawns the next occurrence exactly once
-- (recurrence_parent_id is unique), with the same people and a fresh
-- checklist. Dates step from the series' anchor in Colombo, so a monthly
-- to-do anchored on Jan 31 runs Feb 28/29, then Mar 31 — no drift — and a
-- late completion catches up to today rather than spawning the missed ones.
-- The series stops after recurrence_until.
--
-- Bell: `todo_assigned` to a new assignee, `todo_reminder` at remind_at (to
-- the assignees, or the creator when nobody is tagged), `todo_completed` to
-- the creator. Reminders are scheduled notifications (0009), rebuilt whenever
-- the time, status, title or people change, and cleared on done or delete.
-- Requires: 0019
-- ============================================================================

-- ─────────────────────────────── table ─────────────────────────────────────
create table if not exists public.todos (
  id                   uuid primary key default gen_random_uuid(),
  workspace            text not null default public.current_workspace() references public.workspaces (id),
  title                text not null,
  notes                text,
  kind                 text not null default 'task',
  status               text not null default 'open',
  priority             text not null default 'normal',
  due_at               timestamptz,               -- all-day: Colombo midnight of the day
  all_day              boolean not null default false,
  remind_at            timestamptz,
  recurrence           text not null default 'none',
  recurrence_until     date,                      -- last day an occurrence may fall on (Colombo)
  recurrence_parent_id uuid unique references public.todos (id) on delete set null,
  recurrence_anchor    timestamptz,               -- the series' first due date; steps count from here
  recurrence_index     integer not null default 0,
  labels               text[] not null default '{}',
  is_private           boolean not null default false,
  lead_id              uuid references public.leads (id) on delete set null,
  client_id            uuid references public.clients (id) on delete set null,
  invoice_id           uuid references public.invoices (id) on delete set null,
  position             integer not null default 0,
  completed_at         timestamptz,
  completed_by         uuid references public.profiles (id) on delete set null,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.todos is
  'Team to-dos. Private ones are visible to their creator and assignees only; recurring ones spawn their next occurrence when done.';
comment on column public.todos.recurrence_parent_id is
  'The occurrence this one was spawned from. Unique: each to-do spawns at most one successor.';

alter table public.todos drop constraint if exists todos_title_check;
alter table public.todos add constraint todos_title_check check (btrim(title) <> '');

alter table public.todos drop constraint if exists todos_kind_check;
alter table public.todos add constraint todos_kind_check check (kind in ('task', 'reminder'));

alter table public.todos drop constraint if exists todos_status_check;
alter table public.todos add constraint todos_status_check check (status in ('open', 'in_progress', 'done'));

alter table public.todos drop constraint if exists todos_priority_check;
alter table public.todos add constraint todos_priority_check check (priority in ('low', 'normal', 'high', 'urgent'));

alter table public.todos drop constraint if exists todos_recurrence_check;
alter table public.todos
  add constraint todos_recurrence_check check (recurrence in ('none', 'daily', 'weekly', 'monthly', 'yearly'));

-- A repeating to-do needs a date to repeat from.
alter table public.todos drop constraint if exists todos_recurrence_due_check;
alter table public.todos add constraint todos_recurrence_due_check check (recurrence = 'none' or due_at is not null);

create index if not exists todos_workspace_idx on public.todos (workspace);
create index if not exists todos_due_idx on public.todos (workspace, status, due_at);
create index if not exists todos_created_by_idx on public.todos (created_by);
create index if not exists todos_lead_idx on public.todos (lead_id);
create index if not exists todos_client_idx on public.todos (client_id);
create index if not exists todos_invoice_idx on public.todos (invoice_id);

drop trigger if exists todos_set_updated_at on public.todos;
create trigger todos_set_updated_at
  before update on public.todos
  for each row execute function public.set_updated_at();

drop trigger if exists todos_stamp_created_by on public.todos;
create trigger todos_stamp_created_by
  before insert or update on public.todos
  for each row execute function private.stamp_created_by();

-- A client link must be a client the caller can see in this workspace (0011);
-- leads and invoices only need to share the workspace (0018's guard) — the
-- picker only offers what the caller can see anyway.
drop trigger if exists todos_guard_client on public.todos;
create trigger todos_guard_client
  before insert or update of client_id, workspace on public.todos
  for each row execute function private.guard_client_link();

drop trigger if exists todos_guard_links on public.todos;
create trigger todos_guard_links
  before insert or update of lead_id, invoice_id, workspace on public.todos
  for each row execute function private.guard_workspace_links('lead_id', 'leads', 'invoice_id', 'invoices');

-- ───────────────────────── completion + series state ───────────────────────
-- Invoker on purpose (see private.guard_profiles): the API never writes the
-- completion stamps or the series bookkeeping; trusted paths (the spawn
-- below, the seed) may.
--   · status → done stamps completed_at/by; leaving done clears them;
--   · a new due date or recurrence re-anchors the series on this occurrence.
create or replace function private.prepare_todo()
returns trigger
language plpgsql
security invoker
as $$
declare
  api boolean := current_user in ('authenticated', 'anon');
begin
  if new.status = 'done' then
    if tg_op = 'UPDATE' and old.status = 'done' then
      -- Trusted updates may move them (the foreign key nulls a deleted account).
      if api then
        new.completed_at := old.completed_at;
        new.completed_by := old.completed_by;
      end if;
    elsif api then
      new.completed_at := now();
      new.completed_by := auth.uid();
    else
      new.completed_at := coalesce(new.completed_at, now());
      new.completed_by := coalesce(new.completed_by, auth.uid());
    end if;
  else
    new.completed_at := null;
    new.completed_by := null;
  end if;

  if tg_op = 'INSERT' then
    if api then
      new.recurrence_parent_id := null;
      new.recurrence_anchor := null;
      new.recurrence_index := 0;
    end if;
  elsif api then
    new.recurrence_parent_id := old.recurrence_parent_id;
    new.recurrence_anchor := old.recurrence_anchor;
    new.recurrence_index := old.recurrence_index;
  end if;

  if new.recurrence = 'none' then
    new.recurrence_until := null;
    new.recurrence_anchor := null;
    new.recurrence_index := 0;
  elsif tg_op = 'UPDATE'
        and (new.due_at, new.recurrence) is distinct from (old.due_at, old.recurrence)
        and new.recurrence_anchor is not distinct from old.recurrence_anchor then
    new.recurrence_anchor := new.due_at;
    new.recurrence_index := 0;
  else
    new.recurrence_anchor := coalesce(new.recurrence_anchor, new.due_at);
  end if;
  return new;
end;
$$;

revoke execute on function private.prepare_todo() from public, anon, authenticated;

drop trigger if exists todos_prepare on public.todos;
create trigger todos_prepare
  before insert or update on public.todos
  for each row execute function private.prepare_todo();

-- ───────────────────────────── participants ────────────────────────────────
create table if not exists public.todo_assignees (
  todo_id     uuid not null references public.todos (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  workspace   text not null default public.current_workspace() references public.workspaces (id),
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (todo_id, user_id)
);

comment on table public.todo_assignees is
  'People tagged on a to-do. They must be able to open To-dos; a private to-do is visible to them.';

create index if not exists todo_assignees_user_idx on public.todo_assignees (user_id);
create index if not exists todo_assignees_workspace_idx on public.todo_assignees (workspace);

create table if not exists public.todo_checklist (
  id         uuid primary key default gen_random_uuid(),
  todo_id    uuid not null references public.todos (id) on delete cascade,
  workspace  text not null default public.current_workspace() references public.workspaces (id),
  body       text not null,
  done       boolean not null default false,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.todo_checklist is 'Steps inside a to-do. A repeating to-do''s next occurrence starts them unticked.';

alter table public.todo_checklist drop constraint if exists todo_checklist_body_check;
alter table public.todo_checklist add constraint todo_checklist_body_check check (btrim(body) <> '');

create index if not exists todo_checklist_todo_idx on public.todo_checklist (todo_id, position);
create index if not exists todo_checklist_workspace_idx on public.todo_checklist (workspace);

-- Children live in their to-do's workspace; an assignee must belong to it
-- (definer: the fence then judges the result, so a demo caller can't hang
-- anything off a live to-do, and no path can tag across workspaces).
create or replace function private.todo_child_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.todo_id is distinct from old.todo_id then
    raise exception 'That can''t move to another to-do.' using errcode = 'check_violation';
  end if;
  new.workspace := (select t.workspace from public.todos t where t.id = new.todo_id);
  if new.workspace is null then
    raise exception 'That to-do doesn''t exist.' using errcode = 'foreign_key_violation';
  end if;
  if tg_table_name = 'todo_assignees'
     and not exists (select 1 from public.profiles p
                     where p.id = (to_jsonb(new) ->> 'user_id')::uuid and p.workspace = new.workspace) then
    raise exception 'That person isn''t part of this workspace.' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.todo_child_workspace() from public, anon, authenticated;

drop trigger if exists todo_assignees_workspace on public.todo_assignees;
create trigger todo_assignees_workspace
  before insert or update on public.todo_assignees
  for each row execute function private.todo_child_workspace();

drop trigger if exists todo_assignees_stamp_assigned_by on public.todo_assignees;
create trigger todo_assignees_stamp_assigned_by
  before insert or update on public.todo_assignees
  for each row execute function private.stamp_by('assigned_by');

drop trigger if exists todo_checklist_workspace on public.todo_checklist;
create trigger todo_checklist_workspace
  before insert or update on public.todo_checklist
  for each row execute function private.todo_child_workspace();

-- The creator or an assignee. Definer: reads todos and todo_assignees past
-- their policies, which is what lets those policies call it.
create or replace function public.is_todo_participant(p_todo uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.todos t
    where t.id = p_todo
      and t.workspace = public.current_workspace()
      and (t.created_by = auth.uid()
           or exists (select 1 from public.todo_assignees a where a.todo_id = t.id and a.user_id = auth.uid()))
  );
$$;

revoke execute on function public.is_todo_participant(uuid) from public, anon, authenticated;
grant execute on function public.is_todo_participant(uuid) to authenticated, service_role;

-- ───────────────────────────── policies ────────────────────────────────────
alter table public.todos          enable row level security;
alter table public.todo_assignees enable row level security;
alter table public.todo_checklist enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['todos', 'todo_assignees', 'todo_checklist'] loop
    execute format('drop policy if exists "workspace fence" on public.%I', t);
    execute format(
      'create policy "workspace fence" on public.%I as restrictive for all to authenticated
         using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
         with check (workspace = (select public.current_workspace()) and (select public.is_active_member()))',
      t
    );
  end loop;
end $$;

drop policy if exists "todos: read" on public.todos;
create policy "todos: read"
  on public.todos for select to authenticated
  using ((select public.can_access('todos'))
         and (not is_private or created_by = (select auth.uid()) or public.is_todo_participant(id)));

drop policy if exists "todos: add" on public.todos;
create policy "todos: add"
  on public.todos for insert to authenticated
  with check ((select public.can_access('todos')));

drop policy if exists "todos: participants or admin edit" on public.todos;
create policy "todos: participants or admin edit"
  on public.todos for update to authenticated
  using ((select public.can_access('todos'))
         and (created_by = (select auth.uid()) or public.is_todo_participant(id) or (select public.is_admin())))
  with check ((select public.can_access('todos'))
              and (created_by = (select auth.uid()) or public.is_todo_participant(id) or (select public.is_admin())));

drop policy if exists "todos: creator or admin deletes" on public.todos;
create policy "todos: creator or admin deletes"
  on public.todos for delete to authenticated
  using ((select public.can_access('todos'))
         and (created_by = (select auth.uid()) or (select public.is_admin())));

-- Children follow their to-do as the caller sees it: visible with it, written
-- by whoever may edit it. Tagging also needs the tagged person to open To-dos,
-- and anyone may untag themselves.
drop policy if exists "todo assignees: read" on public.todo_assignees;
create policy "todo assignees: read"
  on public.todo_assignees for select to authenticated
  using ((select public.can_access('todos'))
         and exists (select 1 from public.todos t where t.id = todo_id));

drop policy if exists "todo assignees: editors tag" on public.todo_assignees;
create policy "todo assignees: editors tag"
  on public.todo_assignees for insert to authenticated
  with check (
    (select public.can_access('todos'))
    and exists (select 1 from public.todos t
                where t.id = todo_id
                  and (t.created_by = (select auth.uid()) or public.is_todo_participant(t.id) or (select public.is_admin())))
    and public.user_can_access(user_id, 'todos')
  );

drop policy if exists "todo assignees: editors or self untag" on public.todo_assignees;
create policy "todo assignees: editors or self untag"
  on public.todo_assignees for delete to authenticated
  using (
    (select public.can_access('todos'))
    and exists (select 1 from public.todos t
                where t.id = todo_id
                  and (user_id = (select auth.uid())
                       or t.created_by = (select auth.uid())
                       or public.is_todo_participant(t.id)
                       or (select public.is_admin())))
  );

drop policy if exists "todo checklist: read" on public.todo_checklist;
create policy "todo checklist: read"
  on public.todo_checklist for select to authenticated
  using ((select public.can_access('todos'))
         and exists (select 1 from public.todos t where t.id = todo_id));

drop policy if exists "todo checklist: editors write" on public.todo_checklist;
create policy "todo checklist: editors write"
  on public.todo_checklist for all to authenticated
  using ((select public.can_access('todos'))
         and exists (select 1 from public.todos t
                     where t.id = todo_id
                       and (t.created_by = (select auth.uid()) or public.is_todo_participant(t.id) or (select public.is_admin()))))
  with check ((select public.can_access('todos'))
              and exists (select 1 from public.todos t
                          where t.id = todo_id
                            and (t.created_by = (select auth.uid()) or public.is_todo_participant(t.id) or (select public.is_admin()))));

revoke all on public.todos, public.todo_assignees, public.todo_checklist from anon;
-- Tagged or untagged, never rewritten.
revoke update on public.todo_assignees from authenticated;

-- ─────────────────────────────── reminders ─────────────────────────────────
-- Rebuilds a to-do's one pending reminder. Idempotent: clear, then schedule
-- again at remind_at if it's still ahead and the to-do isn't done. Goes to
-- the assignees, or the creator when nobody is tagged. No actor — a reminder
-- you set for yourself still reaches you.
create or replace function private.reschedule_todo_reminder(p_todo uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t   public.todos;
  who uuid[];
begin
  perform private.clear_pending('todo', p_todo, array['todo_reminder']);

  select * into t from public.todos where id = p_todo;
  if not found or t.status = 'done' or t.remind_at is null or t.remind_at <= now() then
    return;
  end if;

  who := array(select a.user_id from public.todo_assignees a where a.todo_id = t.id);
  if cardinality(who) = 0 then
    who := array[t.created_by];
  end if;

  perform private.notify(
    array(select u from private.users_with_access('todos', t.workspace) u where u = any (who)),
    t.workspace,
    'todo_reminder',
    format('Reminder · %s', t.title),
    case when t.due_at is not null then 'Due ' || private.local_when(t.due_at, t.all_day) end,
    '/admin/todos?open=' || t.id,
    'todo', t.id,
    t.remind_at,
    null
  );
end;
$$;

revoke execute on function private.reschedule_todo_reminder(uuid) from public, anon, authenticated;

-- ───────────────────────────── repeating ───────────────────────────────────
-- The k-th occurrence of a series, stepped from the anchor's Colombo wall
-- clock. Month and year steps clamp to the month's last day and always count
-- from the anchor, so Jan 31 → Feb 28 → Mar 31.
create or replace function private.todo_occurrence(p_anchor timestamptz, p_recurrence text, p_index integer)
returns timestamptz
language sql
immutable
as $$
  select ((p_anchor at time zone 'Asia/Colombo') + case p_recurrence
           when 'daily'   then make_interval(days => p_index)
           when 'weekly'  then make_interval(days => 7 * p_index)
           when 'monthly' then make_interval(months => p_index)
           when 'yearly'  then make_interval(years => p_index)
         end) at time zone 'Asia/Colombo';
$$;

-- The next occurrence after a finished one: the next step of the series, or
-- the first one falling today or later when it was finished late. Nothing past
-- recurrence_until. Same title, notes, links and people, a fresh checklist,
-- the reminder kept at the same distance before the due time. At most once
-- per to-do (the unique recurrence_parent_id). The copied assignees aren't
-- told they've been assigned again (flowstate.todo_spawn); they do get the
-- new reminder.
create or replace function private.spawn_next_todo(p_todo uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t      public.todos;
  anchor timestamptz;
  k      integer;
  due    timestamptz;
  v_id   uuid;
  prev   text := current_setting('flowstate.todo_spawn', true);
begin
  select * into t from public.todos where id = p_todo;
  if not found or t.recurrence = 'none' or t.due_at is null then
    return null;
  end if;
  anchor := coalesce(t.recurrence_anchor, t.due_at);

  k := coalesce(t.recurrence_index, 0) + 1;
  -- Late? Jump close to today (one step short of the estimate), then walk.
  k := greatest(k, (case t.recurrence
         when 'daily' then public.local_today() - (anchor at time zone 'Asia/Colombo')::date
         when 'weekly' then (public.local_today() - (anchor at time zone 'Asia/Colombo')::date) / 7
         when 'monthly' then ((extract(year from public.local_today()) - extract(year from anchor at time zone 'Asia/Colombo')) * 12
                              + extract(month from public.local_today()) - extract(month from anchor at time zone 'Asia/Colombo'))::integer
         else (extract(year from public.local_today()) - extract(year from anchor at time zone 'Asia/Colombo'))::integer
       end) - 1);
  loop
    due := private.todo_occurrence(anchor, t.recurrence, k);
    exit when (due at time zone 'Asia/Colombo')::date >= public.local_today();
    k := k + 1;
  end loop;

  if t.recurrence_until is not null and (due at time zone 'Asia/Colombo')::date > t.recurrence_until then
    return null;
  end if;

  perform set_config('flowstate.todo_spawn', 'on', true);

  insert into public.todos (
    workspace, title, notes, kind, status, priority, due_at, all_day, remind_at,
    recurrence, recurrence_until, recurrence_parent_id, recurrence_anchor, recurrence_index,
    labels, is_private, lead_id, client_id, invoice_id, position, created_by
  )
  values (
    t.workspace, t.title, t.notes, t.kind, 'open', t.priority, due, t.all_day,
    case when t.remind_at is not null then due - (t.due_at - t.remind_at) end,
    t.recurrence, t.recurrence_until, t.id, anchor, k,
    t.labels, t.is_private, t.lead_id, t.client_id, t.invoice_id, t.position, t.created_by
  )
  on conflict (recurrence_parent_id) do nothing
  returning id into v_id;

  if v_id is not null then
    insert into public.todo_assignees (todo_id, user_id, assigned_by)
    select v_id, a.user_id, a.assigned_by
    from public.todo_assignees a
    where a.todo_id = t.id
      and a.user_id in (select private.users_with_access('todos', t.workspace));

    insert into public.todo_checklist (todo_id, body, position)
    select v_id, c.body, c.position from public.todo_checklist c where c.todo_id = t.id;
  end if;

  perform set_config('flowstate.todo_spawn', coalesce(prev, ''), true);
  return v_id;
end;
$$;

revoke execute on function private.todo_occurrence(timestamptz, text, integer), private.spawn_next_todo(uuid)
  from public, anon, authenticated;

-- ──────────────────────── to-do lifecycle triggers ─────────────────────────
-- Reminder kept in step; done → the creator hears (unless they did it) and a
-- repeating to-do spawns its next occurrence; deleted → pending alerts go.
create or replace function private.todo_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
begin
  if tg_op = 'DELETE' then
    perform private.clear_pending('todo', old.id);
    return null;
  end if;

  if tg_op = 'INSERT'
     or (new.remind_at, new.status, new.title, new.due_at, new.all_day)
        is distinct from (old.remind_at, old.status, old.title, old.due_at, old.all_day) then
    perform private.reschedule_todo_reminder(new.id);
  end if;

  if tg_op = 'UPDATE' and new.status = 'done' and old.status <> 'done' then
    select coalesce(nullif(btrim(p.full_name), ''), p.email) into who from public.profiles p where p.id = auth.uid();
    perform private.notify(
      array(select u from private.users_with_access('todos', new.workspace) u where u = new.created_by),
      new.workspace,
      'todo_completed',
      format('Done · %s', new.title),
      case when who is not null then 'Completed by ' || who end,
      '/admin/todos?open=' || new.id,
      'todo', new.id
    );
    perform private.spawn_next_todo(new.id);
  end if;
  return null;
end;
$$;

revoke execute on function private.todo_lifecycle() from public, anon, authenticated;

drop trigger if exists todos_lifecycle on public.todos;
create trigger todos_lifecycle
  after insert or update or delete on public.todos
  for each row execute function private.todo_lifecycle();

-- A new assignee hears about it (unless they tagged themselves, the to-do is
-- already done, or it's a repeating to-do's next occurrence) and takes over
-- the reminder. Someone untagged loses their unread "assigned" alert.
create or replace function private.notify_todo_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.todos;
begin
  if tg_op = 'INSERT' then
    select * into t from public.todos where id = new.todo_id;
    if found and t.status <> 'done' and not private.flag('todo_spawn') then
      perform private.notify(
        array(select u from private.users_with_access('todos', t.workspace) u where u = new.user_id),
        t.workspace,
        'todo_assigned',
        format('To-do for you · %s', t.title),
        nullif(concat_ws(' · ',
          case when t.due_at is not null then 'Due ' || private.local_when(t.due_at, t.all_day) end,
          case when t.priority in ('high', 'urgent') then initcap(t.priority) || ' priority' end
        ), ''),
        '/admin/todos?open=' || t.id,
        'todo', t.id
      );
    end if;
  else
    delete from public.notifications
    where entity_type = 'todo' and entity_id = old.todo_id and recipient_id = old.user_id
      and type = 'todo_assigned' and read_at is null;
  end if;

  perform private.reschedule_todo_reminder(coalesce(new.todo_id, old.todo_id));
  return null;
end;
$$;

revoke execute on function private.notify_todo_assignee() from public, anon, authenticated;

drop trigger if exists todo_assignees_notify on public.todo_assignees;
create trigger todo_assignees_notify
  after insert or delete on public.todo_assignees
  for each row execute function private.notify_todo_assignee();

-- ───────────────────────────── activity log ────────────────────────────────
-- Private to-dos stay out of the trail (the super admin isn't a participant).
-- Completion stamps and series bookkeeping are noise next to the status.
drop trigger if exists todos_activity on public.todos;
create trigger todos_activity
  after insert or update on public.todos
  for each row when (not new.is_private)
  execute function private.log_activity(
    'todo', 'title', '{completed_at,completed_by,recurrence_anchor,recurrence_index,recurrence_parent_id}'
  );

drop trigger if exists todos_activity_delete on public.todos;
create trigger todos_activity_delete
  after delete on public.todos
  for each row when (not old.is_private)
  execute function private.log_activity('todo', 'title', '{}');

-- Tagging is logged against the to-do. Assignees that leave with their to-do
-- (the cascade) or arrive with a spawned occurrence aren't news of their own.
create or replace function private.log_todo_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r   public.todo_assignees := coalesce(new, old);
  t   public.todos;
  who text;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  select * into t from public.todos where id = r.todo_id;
  if not found or t.is_private then
    return null;
  end if;
  select coalesce(nullif(btrim(p.full_name), ''), p.email) into who from public.profiles p where p.id = r.user_id;

  perform private.log_event(
    r.workspace,
    case when tg_op = 'INSERT' then 'assigned' else 'unassigned' end,
    'todo', t.id, t.title,
    case
      when tg_op = 'INSERT' and r.user_id = auth.uid() then format('took “%s”', left(t.title, 80))
      when tg_op = 'INSERT' then format('assigned %s to “%s”', coalesce(who, 'someone'), left(t.title, 80))
      when r.user_id = auth.uid() then format('left “%s”', left(t.title, 80))
      else format('unassigned %s from “%s”', coalesce(who, 'someone'), left(t.title, 80))
    end
  );
  return null;
end;
$$;

revoke execute on function private.log_todo_assignee() from public, anon, authenticated;

drop trigger if exists todo_assignees_activity on public.todo_assignees;
create trigger todo_assignees_activity
  after insert or delete on public.todo_assignees
  for each row execute function private.log_todo_assignee();
