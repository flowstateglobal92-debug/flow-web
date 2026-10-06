-- ============================================================================
-- 0018 · Shared calendar
-- The calendar stops being one person's dashboard widget and becomes the
-- team's: everyone with the Calendar module sees every event in their
-- workspace, but only the person who created an event (or an admin) may
-- change, tick off or delete it.
--
-- Events gain a place (location, meeting link) and attendees. Tagging someone
-- invites them through the bell, and everyone on the event — attendees plus
-- the creator — gets one "starting soon" alert 15 minutes before it begins
-- (09:00 Colombo on the day for all-day events). The alert is a scheduled
-- notification (0009), rebuilt whenever the time, the title or the people
-- change, and dropped when the event is done or deleted.
--
-- Attendees are a child table: they live in their event's workspace, follow
-- its visibility, and only the event's editors may add people — who must be
-- able to open the calendar themselves. An attendee may always take
-- themselves off.
-- Requires: 0017
-- ============================================================================

-- ─────────────────────────────── columns ───────────────────────────────────
alter table public.calendar_events add column if not exists location text;
alter table public.calendar_events add column if not exists meeting_url text;

-- The app normalises links to http(s); a javascript: URL would run on click.
alter table public.calendar_events drop constraint if exists calendar_events_meeting_url_check;
alter table public.calendar_events
  add constraint calendar_events_meeting_url_check check (meeting_url is null or meeting_url ~* '^https?://');

comment on column public.calendar_events.meeting_url is 'Video-call link (http/https only).';

-- ─────────────────────── links stay in their workspace ──────────────────────
-- Foreign keys ignore RLS and workspaces, so without this a demo row could
-- point at a live lead (or the reverse) just by knowing its id.
-- tg_argv holds (column, table) pairs. Definer on purpose: the caller may not
-- be able to read the linked table (a calendar-only member can't see leads),
-- and only the workspace is judged. 0020 reuses it for to-dos.
create or replace function private.guard_workspace_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  i      integer := 0;
  col    text;
  tbl    text;
  target uuid;
  ws     text;
begin
  while i + 1 < tg_nargs loop
    col := tg_argv[i];
    tbl := tg_argv[i + 1];
    i := i + 2;
    target := (to_jsonb(new) ->> col)::uuid;
    continue when target is null;
    if tg_op = 'UPDATE' then
      continue when target is not distinct from (to_jsonb(old) ->> col)::uuid
                and new.workspace is not distinct from old.workspace;
    end if;

    execute format('select workspace from public.%I where id = $1', tbl) into ws using target;
    if ws is distinct from new.workspace then
      raise exception 'That % doesn''t exist in this workspace.',
        case tbl when 'inquiries' then 'inquiry' else rtrim(tbl, 's') end
        using errcode = 'foreign_key_violation';
    end if;
  end loop;
  return new;
end;
$$;

revoke execute on function private.guard_workspace_links() from public, anon, authenticated;

drop trigger if exists calendar_events_guard_links on public.calendar_events;
create trigger calendar_events_guard_links
  before insert or update of lead_id, inquiry_id, workspace on public.calendar_events
  for each row execute function private.guard_workspace_links('lead_id', 'leads', 'inquiry_id', 'inquiries');

-- ───────────────────────────── event policies ──────────────────────────────
-- 0007's single "calendar: module" policy let anyone with the calendar edit
-- anything; reading stays shared, writing becomes the creator's (or an admin's).
drop policy if exists "calendar: module" on public.calendar_events;

drop policy if exists "calendar: read" on public.calendar_events;
create policy "calendar: read"
  on public.calendar_events for select to authenticated
  using ((select public.can_access('calendar')));

drop policy if exists "calendar: add" on public.calendar_events;
create policy "calendar: add"
  on public.calendar_events for insert to authenticated
  with check ((select public.can_access('calendar')));

drop policy if exists "calendar: creator or admin edits" on public.calendar_events;
create policy "calendar: creator or admin edits"
  on public.calendar_events for update to authenticated
  using ((select public.can_access('calendar'))
         and (created_by = (select auth.uid()) or (select public.is_admin())))
  with check ((select public.can_access('calendar'))
              and (created_by = (select auth.uid()) or (select public.is_admin())));

drop policy if exists "calendar: creator or admin deletes" on public.calendar_events;
create policy "calendar: creator or admin deletes"
  on public.calendar_events for delete to authenticated
  using ((select public.can_access('calendar'))
         and (created_by = (select auth.uid()) or (select public.is_admin())));

revoke all on public.calendar_events from anon;

-- ─────────────────────────────── attendees ─────────────────────────────────
create table if not exists public.calendar_event_attendees (
  event_id   uuid not null references public.calendar_events (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  workspace  text not null default public.current_workspace() references public.workspaces (id),
  added_by   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

comment on table public.calendar_event_attendees is
  'People tagged on an event. Adding one invites them; everyone on it gets a reminder 15 minutes before.';

create index if not exists calendar_event_attendees_user_idx on public.calendar_event_attendees (user_id);
create index if not exists calendar_event_attendees_workspace_idx on public.calendar_event_attendees (workspace);

-- An attendee lives in their event's workspace and must belong to it (definer:
-- the fence then judges the result, so a demo caller can't tag onto a live
-- event, and even a trusted path can't tag someone from the other workspace).
create or replace function private.event_attendee_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (new.event_id, new.user_id) is distinct from (old.event_id, old.user_id) then
    raise exception 'Remove the attendee and add them again instead.' using errcode = 'check_violation';
  end if;
  new.workspace := (select e.workspace from public.calendar_events e where e.id = new.event_id);
  if new.workspace is null then
    raise exception 'That event doesn''t exist.' using errcode = 'foreign_key_violation';
  end if;
  if not exists (select 1 from public.profiles p where p.id = new.user_id and p.workspace = new.workspace) then
    raise exception 'That person isn''t part of this workspace.' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

-- Like private.stamp_created_by, for any "who did it" column (tg_argv[0]):
-- from the API it's the caller, for good. Trusted paths may set it.
create or replace function private.stamp_by()
returns trigger
language plpgsql
security invoker
as $$
declare
  col text := tg_argv[0];
  who uuid;
begin
  if tg_op = 'INSERT' then
    who := case when current_user in ('authenticated', 'anon') then auth.uid()
                else coalesce((to_jsonb(new) ->> col)::uuid, auth.uid()) end;
  elsif current_user in ('authenticated', 'anon') then
    who := (to_jsonb(old) ->> col)::uuid;
  else
    -- Trusted, e.g. the foreign key nulling a deleted account.
    return new;
  end if;
  return jsonb_populate_record(new, jsonb_build_object(col, who));
end;
$$;

revoke execute on function private.event_attendee_workspace(), private.stamp_by() from public, anon, authenticated;

drop trigger if exists calendar_event_attendees_workspace on public.calendar_event_attendees;
create trigger calendar_event_attendees_workspace
  before insert or update on public.calendar_event_attendees
  for each row execute function private.event_attendee_workspace();

drop trigger if exists calendar_event_attendees_stamp_added_by on public.calendar_event_attendees;
create trigger calendar_event_attendees_stamp_added_by
  before insert or update on public.calendar_event_attendees
  for each row execute function private.stamp_by('added_by');

alter table public.calendar_event_attendees enable row level security;

drop policy if exists "workspace fence" on public.calendar_event_attendees;
create policy "workspace fence" on public.calendar_event_attendees as restrictive for all to authenticated
  using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
  with check (workspace = (select public.current_workspace()) and (select public.is_active_member()));

-- Seen with the event. The parent checks run under the caller's own RLS, and
-- the events' policies never look back at attendees, so nothing recurses.
drop policy if exists "event attendees: read" on public.calendar_event_attendees;
create policy "event attendees: read"
  on public.calendar_event_attendees for select to authenticated
  using ((select public.can_access('calendar'))
         and exists (select 1 from public.calendar_events e where e.id = event_id));

-- The event's editors tag people, and only people who can open the calendar.
drop policy if exists "event attendees: editors add" on public.calendar_event_attendees;
create policy "event attendees: editors add"
  on public.calendar_event_attendees for insert to authenticated
  with check (
    (select public.can_access('calendar'))
    and exists (select 1 from public.calendar_events e
                where e.id = event_id and (e.created_by = (select auth.uid()) or (select public.is_admin())))
    and public.user_can_access(user_id, 'calendar')
  );

-- Editors remove anyone; an attendee can always take themselves off.
drop policy if exists "event attendees: editors or self remove" on public.calendar_event_attendees;
create policy "event attendees: editors or self remove"
  on public.calendar_event_attendees for delete to authenticated
  using (
    (select public.can_access('calendar'))
    and exists (select 1 from public.calendar_events e
                where e.id = event_id
                  and (user_id = (select auth.uid())
                       or e.created_by = (select auth.uid())
                       or (select public.is_admin())))
  );

-- Added or removed, never rewritten.
revoke all on public.calendar_event_attendees from anon;
revoke update on public.calendar_event_attendees from authenticated;

-- ───────────────────────────── participant check ───────────────────────────
-- The creator or an attendee — for "Mine" filters and later policies.
-- Definer so it can look at attendees without going through their RLS.
create or replace function public.is_event_participant(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.calendar_events e
    where e.id = p_event
      and e.workspace = public.current_workspace()
      and (e.created_by = auth.uid()
           or exists (select 1 from public.calendar_event_attendees a
                      where a.event_id = e.id and a.user_id = auth.uid()))
  );
$$;

revoke execute on function public.is_event_participant(uuid) from public, anon, authenticated;
grant execute on function public.is_event_participant(uuid) to authenticated, service_role;

-- ─────────────────────────────── reminders ─────────────────────────────────
-- `Tue 14 Oct · 10:30` (or just the day when it's all day), in Colombo.
-- 0020 uses it for to-dos.
create or replace function private.local_when(p_at timestamptz, p_all_day boolean default false)
returns text
language sql
stable
as $$
  select to_char(p_at at time zone 'Asia/Colombo', 'Dy FMDD Mon')
         || case when p_all_day then '' else ' · ' || to_char(p_at at time zone 'Asia/Colombo', 'HH24:MI') end;
$$;

-- Rebuilds an event's one pending "starting soon" alert for everyone on it
-- who can still open the calendar. Idempotent: clear, then schedule again if
-- the event is still ahead and not done. No actor — the creator hears it too.
create or replace function private.reschedule_event_reminders(p_event uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e       public.calendar_events;
  remind  timestamptz;
begin
  perform private.clear_pending('event', p_event, array['event_reminder']);

  select * into e from public.calendar_events where id = p_event;
  if not found or e.done then
    return;
  end if;
  remind := case
    when e.all_day then private.local_at((e.starts_at at time zone 'Asia/Colombo')::date, '09:00')
    else e.starts_at - interval '15 minutes'
  end;
  if remind <= now() then
    return;
  end if;

  perform private.notify(
    array(
      select u from private.users_with_access('calendar', e.workspace) u
      where u = e.created_by
         or u in (select a.user_id from public.calendar_event_attendees a where a.event_id = e.id)
    ),
    e.workspace,
    'event_reminder',
    format('%s · %s', case when e.all_day then 'Today' else 'In 15 minutes' end, e.title),
    concat_ws(' · ', private.local_when(e.starts_at, e.all_day), nullif(btrim(e.location), '')),
    '/admin/calendar?event=' || e.id,
    'event', e.id,
    remind,
    null
  );
end;
$$;

create or replace function private.schedule_event_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform private.clear_pending('event', old.id);
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.starts_at, new.all_day, new.done, new.title, new.location)
         is not distinct from (old.starts_at, old.all_day, old.done, old.title, old.location) then
    return null;
  end if;
  perform private.reschedule_event_reminders(new.id);
  return null;
end;
$$;

revoke execute on function private.local_when(timestamptz, boolean), private.reschedule_event_reminders(uuid),
  private.schedule_event_reminders()
  from public, anon, authenticated;

drop trigger if exists calendar_events_reminders on public.calendar_events;
create trigger calendar_events_reminders
  after insert or update or delete on public.calendar_events
  for each row execute function private.schedule_event_reminders();

-- ───────────────────────────── invitations ─────────────────────────────────
-- A new attendee hears about it (unless they added themselves, or the event
-- is done or already over) and joins the reminder. Someone taken off loses
-- their unread invite and their pending reminder.
create or replace function private.notify_event_attendee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.calendar_events;
begin
  if tg_op = 'INSERT' then
    select * into e from public.calendar_events where id = new.event_id;
    if found and not e.done
       and (case when e.all_day
                 then (coalesce(e.ends_at, e.starts_at) at time zone 'Asia/Colombo')::date >= public.local_today()
                 else coalesce(e.ends_at, e.starts_at) > now() end) then
      perform private.notify(
        array(select u from private.users_with_access('calendar', e.workspace) u where u = new.user_id),
        e.workspace,
        'event_invite',
        format('You''re invited · %s', e.title),
        concat_ws(' · ', private.local_when(e.starts_at, e.all_day), nullif(btrim(e.location), '')),
        '/admin/calendar?event=' || e.id,
        'event', e.id
      );
    end if;
  else
    delete from public.notifications
    where entity_type = 'event' and entity_id = old.event_id and recipient_id = old.user_id
      and type = 'event_invite' and read_at is null;
  end if;

  perform private.reschedule_event_reminders(coalesce(new.event_id, old.event_id));
  return null;
end;
$$;

revoke execute on function private.notify_event_attendee() from public, anon, authenticated;

drop trigger if exists calendar_event_attendees_notify on public.calendar_event_attendees;
create trigger calendar_event_attendees_notify
  after insert or delete on public.calendar_event_attendees
  for each row execute function private.notify_event_attendee();

-- ───────────────────────────── activity log ────────────────────────────────
-- Logged against the event (0010 already logs the event itself). Attendees
-- that leave with their event (the foreign-key cascade) are part of that
-- deletion, not a change of their own.
create or replace function private.log_event_attendee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r   public.calendar_event_attendees := coalesce(new, old);
  ev  text;
  who text;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  select e.title into ev from public.calendar_events e where e.id = r.event_id;
  if not found then
    return null;
  end if;
  select coalesce(nullif(btrim(p.full_name), ''), p.email) into who from public.profiles p where p.id = r.user_id;

  perform private.log_event(
    r.workspace,
    case when tg_op = 'INSERT' then 'attendee_added' else 'attendee_removed' end,
    'event', r.event_id, ev,
    case
      when tg_op = 'INSERT' then format('invited %s to “%s”', coalesce(who, 'someone'), left(ev, 80))
      when r.user_id = auth.uid() then format('left “%s”', left(ev, 80))
      else format('removed %s from “%s”', coalesce(who, 'someone'), left(ev, 80))
    end
  );
  return null;
end;
$$;

revoke execute on function private.log_event_attendee() from public, anon, authenticated;

drop trigger if exists calendar_event_attendees_activity on public.calendar_event_attendees;
create trigger calendar_event_attendees_activity
  after insert or delete on public.calendar_event_attendees
  for each row execute function private.log_event_attendee();
