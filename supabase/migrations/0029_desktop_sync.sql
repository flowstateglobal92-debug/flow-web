-- ============================================================================
-- 0029 · Desktop sync
-- What the Flow State desktop app needs to keep a local copy of the workspace
-- through PowerSync (supabase/powersync/sync-config.yaml). Additive: the web
-- admin behaves exactly as before.
--
--   1. public.sync_grants — private.role_allows(), the one access rule, written
--      out as rows a sync service can filter on: one row per module a person
--      may open, plus the markers 'member', 'admin' and 'super_admin'. A
--      trigger on profiles keeps it in step. PowerSync replicates without RLS,
--      so the streams read this table instead of calling can_access(). Nothing
--      in the API can read or write it.
--   2. todo_assignees and calendar_event_attendees get their own id. A device
--      addresses every row by an id; both tables were keyed by (parent, person)
--      only. The keys stay as they are.
--   3. save_invoice can create a draft with an id the caller chose: send
--      "is_new": true with the id. A draft made offline on a desktop keeps the
--      id it was made with, so links to it (to-dos, comments) still point at
--      it. Without the flag nothing changes: an unknown id is refused, so a
--      draft someone deleted is never brought back by a stale editor.
--   4. The publication PowerSync replicates from. The login it connects with is
--      not made here — it needs a password. See supabase/README.md.
--   5. A private mail-outbox bucket. The desktop uploads a message's
--      attachments here (up to 20MB, too big for a function request) and the
--      mail function reads them from here, then removes them.
--   6. Who may see a private to-do — its creator and the people tagged on it —
--      kept on the to-do and on its assignee, checklist and comment rows, so
--      the streams decide from the row itself. A lookup per row would make a
--      sync bucket per to-do, and the sync service refuses a person past 1,000.
--
-- Requires: 0027. Idempotent.
-- ============================================================================

-- ─────────────────────────────── 1. grants ─────────────────────────────────
create table if not exists public.sync_grants (
  user_id   uuid not null references public.profiles (id) on delete cascade,
  module    text not null,
  workspace text not null references public.workspaces (id),
  -- The device needs one id per row. A plain column, filled in below:
  -- logical replication doesn't carry generated columns.
  id        text not null,
  primary key (user_id, module)
);

comment on table public.sync_grants is
  'private.role_allows() as rows, for the desktop sync streams. Maintained by a trigger on profiles; not readable through the API.';

create index if not exists sync_grants_workspace_idx on public.sync_grants (workspace);
create unique index if not exists sync_grants_id_key on public.sync_grants (id);

alter table public.sync_grants enable row level security;
-- No permissive policies: the API roles see nothing. (Supabase grants every
-- new table to them by default, so take that back too.) The fence is here
-- only because every table with a workspace column carries it.
revoke all on public.sync_grants from anon, authenticated;
drop policy if exists "workspace fence" on public.sync_grants;
create policy "workspace fence" on public.sync_grants as restrictive for all to authenticated
  using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
  with check (workspace = (select public.current_workspace()) and (select public.is_active_member()));

-- What `p_user` may open right now, by the same rule as every policy.
create or replace function private.sync_grants_for(p_user uuid)
returns table (module text, workspace text)
language sql
stable
security definer
set search_path = public
as $$
  select m.module, p.workspace
  from public.profiles p
  cross join unnest(array[
    'dashboard', 'inquiries', 'email', 'crm', 'clients', 'invoices', 'finance',
    'reports', 'calendar', 'todos', 'workload', 'team'
  ]) as m(module)
  where p.id = p_user
    and private.role_allows(p.role, p.permissions, p.workspace, p.is_active, m.module)
  union all
  select r.marker, p.workspace
  from public.profiles p
  cross join lateral (values
    -- is_active_member()
    ('member', p.is_active and p.role in ('super_admin', 'admin', 'member')),
    -- is_admin()
    ('admin', p.is_active and p.role in ('super_admin', 'admin')),
    -- is_super_admin()
    ('super_admin', p.is_active and p.role = 'super_admin' and p.workspace = 'live')
  ) as r(marker, allowed)
  where p.id = p_user and r.allowed;
$$;

-- Bring one person's rows in line, touching only what changed so the sync
-- service sees no churn.
create or replace function private.refresh_sync_grants(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.sync_grants g
  where g.user_id = p_user
    and not exists (
      select 1 from private.sync_grants_for(p_user) w
      where w.module = g.module and w.workspace = g.workspace
    );

  insert into public.sync_grants (user_id, module, workspace, id)
  select p_user, w.module, w.workspace, p_user::text || ':' || w.module
  from private.sync_grants_for(p_user) w
  on conflict (user_id, module) do update
    set workspace = excluded.workspace
    where public.sync_grants.workspace is distinct from excluded.workspace;
end;
$$;

create or replace function private.sync_grants_follow_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.refresh_sync_grants(new.id);
  return null;
end;
$$;

revoke execute on function private.sync_grants_for(uuid), private.refresh_sync_grants(uuid),
  private.sync_grants_follow_profile() from public, anon, authenticated;

drop trigger if exists profiles_sync_grants on public.profiles;
create trigger profiles_sync_grants
  after insert or update of role, permissions, workspace, is_active on public.profiles
  for each row execute function private.sync_grants_follow_profile();

-- Everyone who exists already.
select private.refresh_sync_grants(id) from public.profiles;

-- ───────────────────────────── 2. link row ids ─────────────────────────────
-- A volatile default gives every existing row its own id.
alter table public.todo_assignees
  add column if not exists id uuid not null default gen_random_uuid();
create unique index if not exists todo_assignees_id_key on public.todo_assignees (id);

alter table public.calendar_event_attendees
  add column if not exists id uuid not null default gen_random_uuid();
create unique index if not exists calendar_event_attendees_id_key on public.calendar_event_attendees (id);

-- ──────────────────────── 3. save_invoice keeps ids ────────────────────────
-- 0013's function, with one change: {"id": …, "is_new": true} creates the
-- draft with that id, or saves over it when it exists already (a retried
-- upload). An id that exists but this caller can't see still fails — on the
-- primary key, not silently. Without "is_new" an unknown id is refused, as
-- before.
create or replace function public.save_invoice(p_invoice jsonb, p_items jsonb default null)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  editable constant text[] := array[
    'client_id', 'lead_id', 'owner_id', 'bill_to_name', 'bill_to_company', 'bill_to_email',
    'bill_to_phone', 'bill_to_address', 'subject', 'issue_date', 'due_date', 'valid_until',
    'currency', 'discount_type', 'discount_value', 'tax_label', 'tax_rate', 'notes', 'terms',
    'payment_details'
  ];
  v_id   uuid := nullif(p_invoice ->> 'id', '')::uuid;
  v_kind text := coalesce(nullif(p_invoice ->> 'kind', ''), 'invoice');
  v_new  boolean;
  v_cols text;
  v_vals text;
  v_set  text;
  v_bad  text;
  prev   text := coalesce(current_setting('flowstate.invoice_batch', true), '');
begin
  if not public.can_access('invoices') then
    raise exception 'You don''t have access to Invoices.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_invoice) is distinct from 'object' then
    raise exception 'Nothing to save.' using errcode = '22023';
  end if;

  if p_items is not null then
    if jsonb_typeof(p_items) <> 'array' then
      raise exception 'Line items must be a list.' using errcode = '22023';
    end if;
    select m into v_bad
    from (
      select case
               when jsonb_typeof(e.item) <> 'object' or nullif(btrim(e.item ->> 'description'), '') is null
                 then 'Every line needs a description.'
               when coalesce((e.item ->> 'quantity')::numeric, 1) <= 0 then 'Quantities must be more than zero.'
               when coalesce((e.item ->> 'unit_price')::numeric, 0) < 0 then 'Rates can''t be negative.'
             end as m
      from jsonb_array_elements(p_items) as e(item)
    ) checks
    where m is not null
    limit 1;
    if v_bad is not null then
      raise exception '%', v_bad using errcode = 'check_violation';
    end if;
  end if;

  -- The whitelisted keys that were sent, limited to columns this schema has.
  -- Names come from the catalog, never the payload.
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
         string_agg('r.' || quote_ident(a.attname), ', ' order by a.attnum),
         string_agg(format('%1$I = r.%1$I', a.attname), ', ' order by a.attnum)
  into v_cols, v_vals, v_set
  from pg_attribute a
  where a.attrelid = 'public.invoices'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attname = any (editable)
    and p_invoice ? a.attname;

  v_new := v_id is null
    or (coalesce((p_invoice ->> 'is_new')::boolean, false)
        and not exists (select 1 from public.invoices where id = v_id));

  if v_new then
    if v_kind not in ('invoice', 'quote') then
      raise exception 'Unknown document type.' using errcode = '22023';
    end if;
    execute format(
      'insert into public.invoices (id, kind%s) select $3, $2%s from jsonb_populate_record(null::public.invoices, $1) r returning id',
      coalesce(', ' || v_cols, ''), coalesce(', ' || v_vals, '')
    ) into v_id using p_invoice, v_kind, coalesce(v_id, gen_random_uuid());
    -- The insert wrote the header (and its triggers filled the defaults); the
    -- update below only recomputes, so it mustn't write the payload again.
    v_set := null;
  else
    perform 1 from public.invoices where id = v_id for update;
    if not found then
      raise exception 'That document isn''t available.' using errcode = 'P0002';
    end if;
  end if;

  if p_items is not null then
    perform set_config('flowstate.invoice_batch', 'on', true);
    delete from public.invoice_items where invoice_id = v_id;
    insert into public.invoice_items (invoice_id, position, description, details, quantity, unit_price)
    select v_id, (e.ord - 1)::integer, btrim(e.item ->> 'description'), nullif(btrim(e.item ->> 'details'), ''),
           coalesce((e.item ->> 'quantity')::numeric, 1), coalesce((e.item ->> 'unit_price')::numeric, 0)
    from jsonb_array_elements(p_items) with ordinality as e(item, ord);
    perform set_config('flowstate.invoice_batch', prev, true);
  end if;

  -- One write to the header after the lines: the edits and the recompute together.
  execute format(
    'update public.invoices i set %s from jsonb_populate_record(null::public.invoices, $1) r where i.id = $2',
    concat_ws(', ', v_set, 'updated_at = now()')
  ) using p_invoice, v_id;

  return v_id;
end;
$$;

-- ────────────────────────────── 4. publication ─────────────────────────────
-- Every table a stream reads, and nothing else (the sync service decodes every
-- change in the publication). activity_log and budget_alerts stay server-side.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'powersync') then
    create publication powersync;
  end if;
end;
$$;

alter publication powersync set table
  public.sync_grants, public.profiles, public.workspaces, public.notifications,
  public.todos, public.todo_assignees, public.todo_checklist,
  public.calendar_events, public.calendar_event_attendees, public.time_off,
  public.clients, public.pipeline_stages, public.leads, public.lead_activities, public.inquiries,
  public.finance_entries, public.finance_attachments, public.budgets,
  public.invoices, public.invoice_items, public.invoice_payments, public.invoice_schedules, public.invoice_settings,
  public.approval_requests, public.comments, public.email_states;

-- ───────────────────────────── 5. mail outbox ──────────────────────────────
-- Objects are named <user id>/<send id>/<file>: each person reads, writes and
-- removes only their own folder, and only while they can open Email. The mail
-- function sends on their behalf with their own session, then removes them.
do $$
begin
  if to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null
     or to_regprocedure('storage.foldername(text)') is null then
    raise notice 'No Supabase Storage here — the mail-outbox bucket was not set up.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('mail-outbox', 'mail-outbox', false, 20971520, null)
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = null;

  begin
    drop policy if exists "mail outbox: own reads" on storage.objects;
    create policy "mail outbox: own reads"
      on storage.objects for select to authenticated
      using (
        bucket_id = 'mail-outbox'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and (select public.can_access('email'))
      );

    drop policy if exists "mail outbox: own uploads" on storage.objects;
    create policy "mail outbox: own uploads"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'mail-outbox'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and (select public.can_access('email'))
      );

    drop policy if exists "mail outbox: own deletes" on storage.objects;
    create policy "mail outbox: own deletes"
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'mail-outbox'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and (select public.can_access('email'))
      );
  exception when insufficient_privilege then
    raise warning 'mail-outbox bucket created, but its storage policies could not be: % — add the three "mail outbox: own …" policies from the bottom of 0029_desktop_sync.sql in Storage → Policies.', sqlerrm;
  end;
end $$;

-- ═══════════════════ 6. who may see a private to-do ═══════════════════════
-- A private to-do is for its creator and the people tagged on it (0020). The
-- sync service can't look that up row by row: every "to-dos I'm tagged on"
-- lookup becomes a bucket of its own, and it stops at 1,000 per person — a
-- busy team passes that within months, and then nothing syncs at all.
--
-- So a private to-do carries its audience — creator ∪ assignees, sorted — and
-- so do its assignee, checklist and comment rows. The streams read it off the
-- row (sync-config.yaml: `auth.user_id() IN audience`). Shared to-dos and
-- their children have none (NULL). Triggers keep it right on every write and
-- ignore anything a client sends; RLS is unchanged and stays the rule — the
-- 0029 tests check that both agree for every person and row.

alter table public.todos add column if not exists audience uuid[];
alter table public.todo_assignees add column if not exists audience uuid[];
alter table public.todo_checklist add column if not exists audience uuid[];
alter table public.comments add column if not exists audience uuid[];

create or replace function private.todo_audience(p_todo uuid, p_private boolean, p_creator uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case when p_private then
    array(
      select distinct u from (
        select p_creator as u
        union all
        select a.user_id from public.todo_assignees a where a.todo_id = p_todo
      ) people
      where u is not null
      order by u
    )
  end
$$;

-- The to-do's own: computed on every write. Named to run after the other
-- BEFORE triggers (they run in name order), once created_by is stamped.
create or replace function private.todo_set_audience()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.audience := private.todo_audience(new.id, new.is_private, new.created_by);
  return new;
end;
$$;

drop trigger if exists todos_z_audience on public.todos;
create trigger todos_z_audience
  before insert or update on public.todos
  for each row execute function private.todo_set_audience();

-- Assignee, checklist and comment rows copy their to-do's.
create or replace function private.todo_child_set_audience()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.audience := case
    when new.todo_id is null then null
    else (select t.audience from public.todos t where t.id = new.todo_id)
  end;
  return new;
end;
$$;

drop trigger if exists todo_assignees_z_audience on public.todo_assignees;
create trigger todo_assignees_z_audience
  before insert or update on public.todo_assignees
  for each row execute function private.todo_child_set_audience();

drop trigger if exists todo_checklist_z_audience on public.todo_checklist;
create trigger todo_checklist_z_audience
  before insert or update on public.todo_checklist
  for each row execute function private.todo_child_set_audience();

drop trigger if exists comments_z_audience on public.comments;
create trigger comments_z_audience
  before insert or update on public.comments
  for each row execute function private.todo_child_set_audience();

-- The audience changed (made private or shared, or someone tagged or
-- untagged): every child follows.
create or replace function private.todo_spread_audience()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.audience is not distinct from old.audience then
    return null;
  end if;
  update public.todo_assignees set audience = new.audience where todo_id = new.id and audience is distinct from new.audience;
  update public.todo_checklist set audience = new.audience where todo_id = new.id and audience is distinct from new.audience;
  update public.comments set audience = new.audience where todo_id = new.id and audience is distinct from new.audience;
  return null;
end;
$$;

drop trigger if exists todos_z_audience_spread on public.todos;
create trigger todos_z_audience_spread
  after update on public.todos
  for each row execute function private.todo_spread_audience();

-- Someone tagged or untagged on a private to-do: its audience changes.
create or replace function private.todo_assignee_moves_audience()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_todo uuid := coalesce(new.todo_id, old.todo_id);
begin
  update public.todos t
     set audience = private.todo_audience(t.id, t.is_private, t.created_by)
   where t.id = v_todo
     and t.is_private
     and t.audience is distinct from private.todo_audience(t.id, t.is_private, t.created_by);
  return null;
end;
$$;

drop trigger if exists todo_assignees_z_audience_moves on public.todo_assignees;
create trigger todo_assignees_z_audience_moves
  after insert or delete or update of user_id on public.todo_assignees
  for each row execute function private.todo_assignee_moves_audience();

revoke execute on function private.todo_audience(uuid, boolean, uuid) from public, anon, authenticated;
revoke execute on function private.todo_set_audience() from public, anon, authenticated;
revoke execute on function private.todo_child_set_audience() from public, anon, authenticated;
revoke execute on function private.todo_spread_audience() from public, anon, authenticated;
revoke execute on function private.todo_assignee_moves_audience() from public, anon, authenticated;

-- Backfill (and repair on a re-run). Recomputing a to-do's audience isn't an
-- edit: keep its updated_at as it is.
alter table public.todos disable trigger todos_set_updated_at;
update public.todos t
   set audience = private.todo_audience(t.id, t.is_private, t.created_by)
 where t.audience is distinct from private.todo_audience(t.id, t.is_private, t.created_by);
alter table public.todos enable trigger todos_set_updated_at;
update public.todo_assignees a set audience = t.audience
  from public.todos t where t.id = a.todo_id and a.audience is distinct from t.audience;
update public.todo_checklist c set audience = t.audience
  from public.todos t where t.id = c.todo_id and c.audience is distinct from t.audience;
update public.comments c set audience = t.audience
  from public.todos t where t.id = c.todo_id and c.audience is distinct from t.audience;
