-- ============================================================================
-- 0019 · Time off
-- Leave, sick days, working from home and travel — one row per stretch of
-- days (optionally half of a single day), shown on the shared calendar's
-- "Who's out" row and in Workload.
--
-- Anyone active may ask for their own; admins may add it for anyone. When the
-- workspace says leave needs approval (0016, on by default), a member's own
-- request lands 'pending' and opens an approval request — admins' leave, and
-- leave an admin adds for someone, is approved on the spot. The answer comes
-- back through decide_approval(), which calls private.apply_time_off_decision
-- below.
--
-- From the API: approved/rejected are never hand-set (that's Approvals); a
-- member can only cancel their own request while it's pending; admins may
-- edit, cancel or remove anything. A request that stops waiting without a
-- decision (cancelled, deleted) withdraws its approval request.
--
-- Visible to the person themselves and to everyone with Calendar or Workload.
-- Requires: 0018
-- ============================================================================

-- ─────────────────────────────── table ─────────────────────────────────────
create table if not exists public.time_off (
  id          uuid primary key default gen_random_uuid(),
  workspace   text not null default public.current_workspace() references public.workspaces (id),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  type        text not null default 'annual',
  starts_on   date not null,
  ends_on     date not null,
  half_day    text,                          -- 'am' | 'pm' on a single day
  note        text,
  status      text not null default 'approved',
  decided_by  uuid references public.profiles (id) on delete set null,
  decided_at  timestamptz,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.time_off is
  'Leave per person. Members'' own requests may wait for approval (workspaces.leave_requires_approval).';

alter table public.time_off drop constraint if exists time_off_type_check;
alter table public.time_off
  add constraint time_off_type_check check (type in ('annual', 'sick', 'wfh', 'travel', 'other'));

alter table public.time_off drop constraint if exists time_off_status_check;
alter table public.time_off
  add constraint time_off_status_check check (status in ('pending', 'approved', 'rejected', 'cancelled'));

-- A year at most; a half day is half of one day.
alter table public.time_off drop constraint if exists time_off_range_check;
alter table public.time_off
  add constraint time_off_range_check check (ends_on >= starts_on and ends_on - starts_on <= 366);

alter table public.time_off drop constraint if exists time_off_half_day_check;
alter table public.time_off
  add constraint time_off_half_day_check check (
    half_day is null or (half_day in ('am', 'pm') and starts_on = ends_on)
  );

create index if not exists time_off_workspace_idx on public.time_off (workspace);
create index if not exists time_off_range_idx on public.time_off (workspace, starts_on, ends_on);
create index if not exists time_off_user_idx on public.time_off (user_id, starts_on desc);

drop trigger if exists time_off_set_updated_at on public.time_off;
create trigger time_off_set_updated_at
  before update on public.time_off
  for each row execute function public.set_updated_at();

drop trigger if exists time_off_stamp_created_by on public.time_off;
create trigger time_off_stamp_created_by
  before insert or update on public.time_off
  for each row execute function private.stamp_created_by();

-- ─────────────────────────────── labels ────────────────────────────────────
-- Same words as TIME_OFF_LABEL in components/admin/timeoff/timeoff.ts.
create or replace function private.time_off_label(p_type text)
returns text
language sql
immutable
as $$
  select case p_type
           when 'annual' then 'Annual leave' when 'sick' then 'Sick leave'
           when 'wfh' then 'Working from home' when 'travel' then 'Travelling'
           else 'Away'
         end;
$$;

-- `14 Oct (morning)` · `12–14 Oct` · `30 Oct – 2 Nov` · `30 Dec 2026 – 2 Jan 2027`
create or replace function private.day_span(p_starts date, p_ends date, p_half text default null)
returns text
language sql
stable
as $$
  select case
    when p_ends is null or p_ends = p_starts then
      to_char(p_starts, 'FMDD Mon')
      || case p_half when 'am' then ' (morning)' when 'pm' then ' (afternoon)' else '' end
    when date_trunc('month', p_starts) = date_trunc('month', p_ends) then
      to_char(p_starts, 'FMDD') || '–' || to_char(p_ends, 'FMDD Mon')
    when extract(year from p_starts) = extract(year from p_ends) then
      to_char(p_starts, 'FMDD Mon') || ' – ' || to_char(p_ends, 'FMDD Mon')
    else
      to_char(p_starts, 'FMDD Mon YYYY') || ' – ' || to_char(p_ends, 'FMDD Mon YYYY')
  end;
$$;

revoke execute on function private.time_off_label(text), private.day_span(date, date, text)
  from public, anon, authenticated;

-- ─────────────────────── the person sets the workspace ─────────────────────
-- Leave belongs to the person's workspace (definer: the fence then judges the
-- result, so a demo admin can't add leave for a live teammate).
create or replace function private.time_off_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.workspace := (select p.workspace from public.profiles p where p.id = new.user_id);
  if new.workspace is null then
    raise exception 'That person doesn''t exist.' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.time_off_workspace() from public, anon, authenticated;

drop trigger if exists time_off_workspace on public.time_off;
create trigger time_off_workspace
  before insert or update of user_id, workspace on public.time_off
  for each row execute function private.time_off_workspace();

-- ──────────────────────────────── guard ────────────────────────────────────
-- Invoker on purpose (see private.guard_profiles): only API callers are held
-- to it. Trusted paths (apply_time_off_decision, the seed, the import) write
-- status and the decision stamps as they please. Runs first among the BEFORE
-- triggers (by name), so it reads the workspace the way the caller sees it.
create or replace function private.guard_time_off()
returns trigger
language plpgsql
security invoker
as $$
declare
  needs_ok boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Read as the caller: teammates in their own workspace only.
    if not exists (select 1 from public.profiles p
                   where p.id = new.user_id and p.is_active and p.role in ('super_admin', 'admin', 'member')) then
      raise exception 'Leave can only be added for an active teammate.' using errcode = 'check_violation';
    end if;

    new.decided_by := null;
    new.decided_at := null;
    if public.is_admin() then
      -- An admin's own leave, or leave they add for someone: decided by them.
      new.status := 'approved';
      new.decided_by := auth.uid();
      new.decided_at := now();
    else
      select w.leave_requires_approval into needs_ok from public.workspaces w where w.id = public.current_workspace();
      new.status := case when coalesce(needs_ok, true) then 'pending' else 'approved' end;
    end if;
    return new;
  end if;

  -- Decisions are stamped by Approvals, never by hand.
  new.decided_by := old.decided_by;
  new.decided_at := old.decided_at;

  if new.user_id is distinct from old.user_id then
    raise exception 'Leave can''t move to someone else — remove it and add it again.' using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'pending' and new.status in ('approved', 'rejected') then
      raise exception 'Leave requests are approved or rejected in Approvals.' using errcode = 'check_violation';
    elsif new.status <> 'cancelled' or old.status not in ('pending', 'approved') then
      raise exception 'Only pending or approved leave can be cancelled — make a new request instead.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- The policies let a member touch only their own pending request; this keeps
  -- that touch to cancelling it.
  if not public.is_admin()
     and (new.type, new.starts_on, new.ends_on, new.half_day, new.note)
         is distinct from (old.type, old.starts_on, old.ends_on, old.half_day, old.note) then
    raise exception 'Cancel this request and make a new one to change it.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_time_off() from public, anon, authenticated;

drop trigger if exists time_off_guard on public.time_off;
create trigger time_off_guard
  before insert or update on public.time_off
  for each row execute function private.guard_time_off();

-- ─────────────────────────────── approvals ─────────────────────────────────
-- Keeps the approval request in step with the leave (0016's helpers). The
-- person on leave is the requester, so they can't decide it themselves.
create or replace function private.sync_time_off_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'pending' then
      perform private.cancel_approval('time_off', old.id);
    end if;
    return null;
  end if;

  if new.status = 'pending' then
    if tg_op = 'INSERT'
       or old.status <> 'pending'
       or (new.type, new.starts_on, new.ends_on, new.half_day)
          is distinct from (old.type, old.starts_on, old.ends_on, old.half_day) then
      perform private.request_approval(
        new.workspace, 'time_off', new.id, new.user_id,
        private.time_off_label(new.type) || ' · ' || private.day_span(new.starts_on, new.ends_on, new.half_day)
      );
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'pending' then
    perform private.cancel_approval('time_off', new.id);
  end if;
  return null;
end;
$$;

revoke execute on function private.sync_time_off_approval() from public, anon, authenticated;

drop trigger if exists time_off_approval on public.time_off;
create trigger time_off_approval
  after insert or update or delete on public.time_off
  for each row execute function private.sync_time_off_approval();

-- decide_approval's hook (0016 looks it up at run time). It has already
-- checked the approver and closed the request; this applies the answer.
create or replace function private.apply_time_off_decision(p_id uuid, p_decision text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'Pick approve or reject.' using errcode = '22023';
  end if;

  update public.time_off
  set status = case p_decision when 'approve' then 'approved' else 'rejected' end,
      decided_by = auth.uid(),
      decided_at = now()
  where id = p_id and workspace = public.current_workspace() and status = 'pending';
  if not found then
    raise exception 'This leave is no longer waiting for approval.' using errcode = 'check_violation';
  end if;
end;
$$;

revoke execute on function private.apply_time_off_decision(uuid, text, text) from public, anon, authenticated;

-- ───────────────────────────── activity log ────────────────────────────────
-- Reads after the actor's name: "approved time off for Nadia Silva · Annual
-- leave · 12–14 Oct". A decision is logged here with the approver as actor.
create or replace function private.log_time_off()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r      public.time_off := coalesce(new, old);
  who    text;
  what   text;
  verb   text;
  diff   jsonb;
  fields text;
begin
  if pg_trigger_depth() > 1 or private.flag('importing') or private.flag('seeding') then
    return null;
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), p.email) into who from public.profiles p where p.id = r.user_id;
  what := private.time_off_label(r.type) || ' · ' || private.day_span(r.starts_on, r.ends_on, r.half_day);

  if tg_op = 'INSERT' then
    verb := case when r.status = 'pending' then 'requested' else 'added' end;
  elsif tg_op = 'DELETE' then
    verb := 'deleted';
  elsif new.status is distinct from old.status then
    verb := new.status;
    diff := jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status));
  else
    select jsonb_object_agg(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new) -> k))
    into diff
    from unnest(array['type', 'starts_on', 'ends_on', 'half_day', 'note']) as k
    where (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k);
    if diff is null then
      return null;
    end if;
    select string_agg(replace(k, '_', ' '), ', ' order by k) into fields from jsonb_object_keys(diff) k;
    verb := 'updated';
  end if;

  insert into public.activity_log (workspace, actor_id, action, entity_type, entity_id, entity_label, summary, changes)
  values (
    r.workspace,
    auth.uid(),
    verb,
    'time_off',
    r.id,
    concat_ws(' · ', who, what),
    concat_ws(' ',
      verb, 'time off',
      case when r.user_id is distinct from auth.uid() then 'for ' || coalesce(who, 'someone') end,
      '· ' || what,
      case when fields is not null then '· ' || fields end
    ),
    diff
  );
  return null;
end;
$$;

revoke execute on function private.log_time_off() from public, anon, authenticated;

drop trigger if exists time_off_activity on public.time_off;
create trigger time_off_activity
  after insert or update or delete on public.time_off
  for each row execute function private.log_time_off();

-- ───────────────────────────── policies ────────────────────────────────────
alter table public.time_off enable row level security;

drop policy if exists "workspace fence" on public.time_off;
create policy "workspace fence" on public.time_off as restrictive for all to authenticated
  using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
  with check (workspace = (select public.current_workspace()) and (select public.is_active_member()));

-- Your own, or everyone's when you plan around people (Calendar, Workload).
drop policy if exists "time off: read" on public.time_off;
create policy "time off: read"
  on public.time_off for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.can_access('calendar'))
    or (select public.can_access('workload'))
  );

drop policy if exists "time off: own or admin adds" on public.time_off;
create policy "time off: own or admin adds"
  on public.time_off for insert to authenticated
  with check (user_id = (select auth.uid()) or (select public.is_admin()));

-- Members: their own pending request, and only to cancel it (the guard holds
-- the other columns). Admins: anything.
drop policy if exists "time off: admin edits, owner cancels" on public.time_off;
create policy "time off: admin edits, owner cancels"
  on public.time_off for update to authenticated
  using ((select public.is_admin()) or (user_id = (select auth.uid()) and status = 'pending'))
  with check ((select public.is_admin()) or (user_id = (select auth.uid()) and status = 'cancelled'));

drop policy if exists "time off: admin or own pending deletes" on public.time_off;
create policy "time off: admin or own pending deletes"
  on public.time_off for delete to authenticated
  using ((select public.is_admin()) or (user_id = (select auth.uid()) and status = 'pending'));

revoke all on public.time_off from anon;
