-- ============================================================================
-- 0010 · Activity log
-- An append-only trail of who changed what, for the super admin (Team →
-- Activity). One generic trigger records inserts, deletes and the columns an
-- update actually changed; housekeeping columns (positions, timestamps) never
-- count as a change, so dragging a kanban card doesn't write a row per card.
--
-- Rows written by other triggers (pg_trigger_depth() > 1) are skipped — the
-- action that caused them is logged once, by its own table. Imports and the
-- demo seed are silent too. Feature migrations attach this to their tables.
-- Requires: 0009
-- ============================================================================

create table if not exists public.activity_log (
  id           bigint generated always as identity primary key,
  workspace    text not null default public.current_workspace() references public.workspaces (id),
  actor_id     uuid references public.profiles (id) on delete set null,
  action       text not null,                 -- created · updated · deleted · or a verb like 'paid'
  entity_type  text not null,                 -- lead · invoice · client · …
  entity_id    uuid,
  entity_label text,
  summary      text not null,                 -- reads after the actor's name: "created invoice INV-0007"
  changes      jsonb,                         -- { column: { from, to } } for updates
  created_at   timestamptz not null default now()
);

comment on table public.activity_log is
  'Audit trail. Written only by private.log_activity() / private.log_event().';

create index if not exists activity_log_feed_idx on public.activity_log (workspace, created_at desc);
create index if not exists activity_log_entity_idx on public.activity_log (entity_type, entity_id);
create index if not exists activity_log_actor_idx on public.activity_log (actor_id, created_at desc);

alter table public.activity_log enable row level security;

drop policy if exists "workspace fence" on public.activity_log;
create policy "workspace fence" on public.activity_log as restrictive for all to authenticated
  using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
  with check (workspace = (select public.current_workspace()) and (select public.is_active_member()));

drop policy if exists "activity: team reads" on public.activity_log;
create policy "activity: team reads"
  on public.activity_log for select to authenticated
  using ((select public.can_access('team')));

revoke all on public.activity_log from anon;
revoke insert, update, delete on public.activity_log from authenticated;

-- ─────────────────────────── explicit events ───────────────────────────────
-- For actions that aren't a plain row change ("recorded a payment of …").
create or replace function private.log_event(
  p_workspace text,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_label text,
  p_summary text,
  p_changes jsonb default null
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
  insert into public.activity_log (workspace, actor_id, action, entity_type, entity_id, entity_label, summary, changes)
  values (p_workspace, auth.uid(), p_action, p_entity_type, p_entity_id, p_label, p_summary, p_changes);
end;
$$;

-- ─────────────────────────── generic trigger ───────────────────────────────
-- tg_argv[0] = entity noun ('lead'), tg_argv[1] = label column ('name'),
-- tg_argv[2] = optional extra columns to ignore, as a text-array literal.
create or replace function private.log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  noun      text := tg_argv[0];
  label_col text := tg_argv[1];
  ignored   text[] := array[
    'id', 'workspace', 'created_at', 'updated_at', 'position', 'created_by', 'search_text'
  ] || coalesce(nullif(tg_argv[2], '')::text[], '{}');
  row_j     jsonb := to_jsonb(coalesce(new, old));
  diff      jsonb;
  label     text;
  verb      text;
  fields    text;
begin
  if pg_trigger_depth() > 1 or private.flag('importing') or private.flag('seeding') then
    return null;
  end if;

  label := nullif(row_j ->> label_col, '');

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new) -> k))
    into diff
    from jsonb_object_keys(to_jsonb(new)) as k
    where k <> all (ignored)
      and (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k);

    if diff is null then
      return null;
    end if;

    select string_agg(replace(k, '_', ' '), ', ' order by k) into fields from jsonb_object_keys(diff) k;
    verb := 'updated';
  else
    verb := case tg_op when 'INSERT' then 'created' else 'deleted' end;
  end if;

  insert into public.activity_log (workspace, actor_id, action, entity_type, entity_id, entity_label, summary, changes)
  values (
    row_j ->> 'workspace',
    auth.uid(),
    verb,
    noun,
    case when (row_j ->> 'id') ~ '^[0-9a-f-]{36}$' then (row_j ->> 'id')::uuid end,
    label,
    concat_ws(' ',
      verb, noun,
      case when label is not null then '“' || left(label, 80) || '”' end,
      case when fields is not null then '· ' || fields end
    ),
    diff
  );
  return null;
end;
$$;

-- ───────────────────── attach to the existing tables ────────────────────────
drop trigger if exists leads_activity on public.leads;
create trigger leads_activity
  after insert or update or delete on public.leads
  for each row execute function private.log_activity('lead', 'name', '{}');

drop trigger if exists pipeline_stages_activity on public.pipeline_stages;
create trigger pipeline_stages_activity
  after insert or update or delete on public.pipeline_stages
  for each row execute function private.log_activity('stage', 'name', '{}');

drop trigger if exists inquiries_activity on public.inquiries;
create trigger inquiries_activity
  after update or delete on public.inquiries
  for each row execute function private.log_activity('inquiry', 'name', '{}');

drop trigger if exists finance_entries_activity on public.finance_entries;
create trigger finance_entries_activity
  after insert or update or delete on public.finance_entries
  for each row execute function private.log_activity('entry', 'description', '{signed_amount}');

drop trigger if exists calendar_events_activity on public.calendar_events;
create trigger calendar_events_activity
  after insert or update or delete on public.calendar_events
  for each row execute function private.log_activity('event', 'title', '{}');

drop trigger if exists profiles_activity on public.profiles;
create trigger profiles_activity
  after insert or update or delete on public.profiles
  for each row execute function private.log_activity('user', 'email', '{}');

-- ─────────────────────────────── hygiene ───────────────────────────────────
-- 0007–0010's private helpers kept Postgres's default EXECUTE for PUBLIC (see
-- 0007). Nobody can reach the schema, but say so twice. Triggers don't need
-- EXECUTE to fire, and the definer functions run as their owner.
revoke execute on all functions in schema private from public, anon, authenticated;
