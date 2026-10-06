-- ============================================================================
-- 0015 · Recurring invoices & retainers
-- A schedule is an invoice template plus a cadence. Each due period becomes
-- one invoice — a draft to review, or issued straight away when an admin has
-- turned on auto_issue (members' schedules always make drafts).
--
-- Run dates are counted from anchor_date every time (anchor + n × interval),
-- never from the previous run, so a schedule anchored on the 31st lands on
-- the 31st or the month's last day and never drifts to the 28th. Dates are
-- Colombo calendar days (public.local_today()).
--
-- run_recurring_invoices() catches up every missed period exactly once (a
-- bounded batch per call, so a long catch-up takes a few runs): unique
-- (schedule_id, period_start) makes a second run a no-op. It runs from
-- pg_cron daily when the extension exists, and lazily whenever the invoice
-- pages load, so a project without pg_cron still gets its invoices. Missed
-- runs are caught up; paused months are not — resuming skips them, and a
-- next run moved off the cadence restarts it (private.schedule_run_dates).
-- Requires: 0014
-- ============================================================================

-- ─────────────────────────────── schedules ─────────────────────────────────
create table if not exists public.invoice_schedules (
  id              uuid primary key default gen_random_uuid(),
  workspace       text not null default public.current_workspace() references public.workspaces (id),
  name            text not null,
  is_retainer     boolean not null default false,
  client_id       uuid references public.clients (id) on delete set null,
  owner_id        uuid references public.profiles (id) on delete set null,
  template        jsonb not null,             -- save_invoice's p_invoice shape + "items": [...]
  amount          numeric(14, 2) not null default 0,   -- display total, computed by the app
  currency        text not null default 'LKR',
  frequency       text not null default 'monthly',
  interval_count  integer not null default 1,
  anchor_date     date not null,
  next_run_on     date not null,
  ends_on         date,
  max_occurrences integer,
  occurrences     integer not null default 0,
  auto_issue      boolean not null default false,
  active          boolean not null default true,
  last_invoice_id uuid references public.invoices (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.invoice_schedules is
  'Recurring invoices and retainers: a template, a cadence counted from anchor_date, and the next run.';

alter table public.invoice_schedules drop constraint if exists invoice_schedules_frequency_check;
alter table public.invoice_schedules
  add constraint invoice_schedules_frequency_check check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly'));

alter table public.invoice_schedules drop constraint if exists invoice_schedules_values_check;
alter table public.invoice_schedules
  add constraint invoice_schedules_values_check check (
    btrim(name) <> ''
    and interval_count >= 1
    and (max_occurrences is null or max_occurrences >= 1)
    and occurrences >= 0
    and amount >= 0
    and currency ~ '^[A-Z]{3}$'
    and jsonb_typeof(template) = 'object'
    and (not template ? 'items' or jsonb_typeof(template -> 'items') = 'array')
  );

create index if not exists invoice_schedules_workspace_idx on public.invoice_schedules (workspace);
create index if not exists invoice_schedules_due_idx on public.invoice_schedules (workspace, next_run_on) where active;
create index if not exists invoice_schedules_client_idx on public.invoice_schedules (client_id);

drop trigger if exists invoice_schedules_set_updated_at on public.invoice_schedules;
create trigger invoice_schedules_set_updated_at
  before update on public.invoice_schedules
  for each row execute function public.set_updated_at();

drop trigger if exists invoice_schedules_stamp_created_by on public.invoice_schedules;
create trigger invoice_schedules_stamp_created_by
  before insert or update on public.invoice_schedules
  for each row execute function private.stamp_created_by();

drop trigger if exists invoice_schedules_stamp_owner on public.invoice_schedules;
create trigger invoice_schedules_stamp_owner
  before insert or update of owner_id on public.invoice_schedules
  for each row execute function private.stamp_owner('owner_id', 'invoices');

drop trigger if exists invoice_schedules_guard_client on public.invoice_schedules;
create trigger invoice_schedules_guard_client
  before insert or update of client_id, workspace on public.invoice_schedules
  for each row execute function private.guard_client_link();

-- Auto-issue skips the review step, so only an admin may switch it on. A
-- member may still edit an admin's schedule, or switch auto-issue off.
create or replace function private.guard_schedules()
returns trigger
language plpgsql
security invoker
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.auto_issue and (tg_op = 'INSERT' or not old.auto_issue) and not public.is_admin() then
    raise exception 'Only an admin can turn on auto-issue — your schedules create drafts to review.'
      using errcode = 'check_violation';
  end if;

  -- What an auto-issuing schedule bills is an admin's call too: a member's
  -- edit would otherwise be numbered and issued with no approval. Switching
  -- auto-issue off in the same save is fine — then it makes drafts.
  if tg_op = 'UPDATE' and old.auto_issue and new.auto_issue and not public.is_admin()
     and (new.template, new.amount, new.currency, new.client_id)
         is distinct from (old.template, old.amount, old.currency, old.client_id) then
    raise exception 'This schedule issues its invoices automatically, so only an admin can change what it bills.'
      using errcode = 'check_violation';
  end if;

  -- Read as the caller, so a schedule can only point at an invoice they can see.
  if new.last_invoice_id is not null
     and (tg_op = 'INSERT' or new.last_invoice_id is distinct from old.last_invoice_id)
     and not exists (select 1 from public.invoices i where i.id = new.last_invoice_id) then
    raise exception 'That invoice isn''t available.' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_schedules() from public, anon, authenticated;

drop trigger if exists invoice_schedules_guard on public.invoice_schedules;
create trigger invoice_schedules_guard
  before insert or update on public.invoice_schedules
  for each row execute function private.guard_schedules();

-- Runs move next_run_on / occurrences / last_invoice_id every period; only
-- people's edits are worth a line.
drop trigger if exists invoice_schedules_activity on public.invoice_schedules;
create trigger invoice_schedules_activity
  after insert or update or delete on public.invoice_schedules
  for each row execute function private.log_activity('schedule', 'name', '{next_run_on,occurrences,last_invoice_id}');

alter table public.invoice_schedules enable row level security;

drop policy if exists "workspace fence" on public.invoice_schedules;
create policy "workspace fence" on public.invoice_schedules as restrictive for all to authenticated
  using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
  with check (workspace = (select public.current_workspace()) and (select public.is_active_member()));

drop policy if exists "invoice schedules: module" on public.invoice_schedules;
create policy "invoice schedules: module"
  on public.invoice_schedules for all to authenticated
  using ((select public.can_access('invoices')))
  with check ((select public.can_access('invoices')));

revoke all on public.invoice_schedules from anon;

-- ───────────────────── the invoice each period makes ────────────────────────
alter table public.invoices
  add column if not exists schedule_id uuid references public.invoice_schedules (id) on delete set null;
alter table public.invoices add column if not exists period_start date;

comment on column public.invoices.period_start is 'For a scheduled invoice: the run date it covers (one invoice per schedule per period).';

create unique index if not exists invoices_schedule_period_idx on public.invoices (schedule_id, period_start);

-- Only a schedule run makes a scheduled invoice; the API can't claim (or
-- block) a period by writing these columns.
create or replace function private.guard_scheduled_invoice()
returns trigger
language plpgsql
security invoker
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (
       (tg_op = 'INSERT' and (new.schedule_id is not null or new.period_start is not null))
       or (tg_op = 'UPDATE' and (new.schedule_id is distinct from old.schedule_id
                                 or new.period_start is distinct from old.period_start))
     ) then
    raise exception 'Recurring invoices are created by their schedule.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_scheduled_invoice() from public, anon, authenticated;

drop trigger if exists invoices_guard_schedule on public.invoices;
create trigger invoices_guard_schedule
  before insert or update of schedule_id, period_start on public.invoices
  for each row execute function private.guard_scheduled_invoice();

-- ───────────────────────────── run dates ───────────────────────────────────
-- The first run date after p_after, counted from the anchor: anchor + k steps
-- for the smallest such k. Month arithmetic clamps to the month's last day
-- (Jan 31 + 1 month = Feb 28) and, because it always starts from the anchor,
-- the next step is Mar 31 again.
create or replace function private.next_run_after(
  p_anchor date, p_frequency text, p_every integer, p_after date
)
returns date
language plpgsql
immutable
as $$
declare
  per   integer := greatest(coalesce(p_every, 1), 1);
  step  integer := per * case p_frequency when 'quarterly' then 3 when 'yearly' then 12 else 1 end;
  k     integer;
  d     date;
begin
  if p_frequency = 'weekly' then
    -- Start one step short of the estimate; the loop walks forward.
    k := greatest((p_after - p_anchor) / (7 * per) - 1, 0);
    loop
      d := p_anchor + k * 7 * per;
      exit when d > p_after;
      k := k + 1;
    end loop;
    return d;
  end if;

  k := greatest(
    ((extract(year from p_after) - extract(year from p_anchor)) * 12
      + extract(month from p_after) - extract(month from p_anchor))::integer / step - 1,
    0
  );
  loop
    d := (p_anchor + make_interval(months => k * step))::date;
    exit when d > p_after;
    k := k + 1;
  end loop;
  return d;
end;
$$;

-- One period's invoice from a schedule: the template's header and lines,
-- dated the run date and due per the workspace's payment terms. Client,
-- owner and currency come from the schedule's own columns (kept valid by
-- their foreign keys and guards); a lead in the template is used only if it
-- still exists in this workspace.
create or replace function private.generate_scheduled_invoice(s public.invoice_schedules, p_period date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t       public.invoices := jsonb_populate_record(null::public.invoices, s.template);
  cfg     public.invoice_settings;
  v_owner uuid;
  v_id    uuid;
  issued  jsonb;
  doc     public.invoices;
  prev    text := coalesce(current_setting('flowstate.invoice_batch', true), '');
begin
  select * into cfg from public.invoice_settings where workspace = s.workspace;
  select p.id into v_owner from public.profiles p
  where p.id = coalesce(s.owner_id, t.owner_id, s.created_by) and p.workspace = s.workspace;

  perform set_config('flowstate.invoice_batch', 'on', true);

  insert into public.invoices (
    workspace, kind, status, schedule_id, period_start, client_id, lead_id, owner_id,
    bill_to_name, bill_to_company, bill_to_email, bill_to_phone, bill_to_address, subject,
    issue_date, due_date, currency, discount_type, discount_value, tax_label, tax_rate,
    notes, terms, payment_details, created_by
  ) values (
    s.workspace, 'invoice', 'draft', s.id, p_period, s.client_id,
    (select l.id from public.leads l where l.id = t.lead_id and l.workspace = s.workspace),
    v_owner,
    coalesce(t.bill_to_name, ''), t.bill_to_company, t.bill_to_email, t.bill_to_phone, t.bill_to_address, t.subject,
    p_period, p_period + coalesce(cfg.default_due_days, 14),
    coalesce(nullif(s.currency, ''), t.currency, 'LKR'),
    coalesce(t.discount_type, 'amount'), coalesce(t.discount_value, 0),
    coalesce(t.tax_label, cfg.tax_label, 'VAT'), coalesce(t.tax_rate, 0),
    coalesce(t.notes, cfg.default_notes), coalesce(t.terms, cfg.default_terms),
    coalesce(t.payment_details, cfg.payment_details),
    s.created_by
  )
  returning id into v_id;

  insert into public.invoice_items (invoice_id, position, description, details, quantity, unit_price)
  select v_id, (e.ord - 1)::integer, btrim(e.item ->> 'description'), nullif(btrim(e.item ->> 'details'), ''),
         coalesce((e.item ->> 'quantity')::numeric, 1), coalesce((e.item ->> 'unit_price')::numeric, 0)
  from jsonb_array_elements(coalesce(s.template -> 'items', '[]'::jsonb)) with ordinality as e(item, ord);

  perform set_config('flowstate.invoice_batch', prev, true);
  update public.invoices set updated_at = now() where id = v_id;

  if s.auto_issue then
    issued := private.issue_invoice(v_id);
  end if;

  select * into doc from public.invoices where id = v_id;
  -- From the system, not whoever happened to open the page: the owner hears
  -- about it even when they triggered the run.
  perform private.notify(
    array(select u from private.users_with_access('invoices', s.workspace) u where u = doc.owner_id),
    s.workspace,
    'recurring_generated',
    case when issued is not null
         then format('%s issued · %s', doc.number, s.name)
         else format('Draft ready to review · %s', s.name) end,
    concat_ws(' · ',
      coalesce(nullif(btrim(doc.bill_to_company), ''), nullif(btrim(doc.bill_to_name), '')),
      private.money(doc.total, doc.currency),
      'for ' || to_char(p_period, 'FMDD Mon YYYY')
    ),
    '/admin/invoices/' || v_id,
    'invoice', v_id,
    now(),
    null
  );
  return v_id;
end;
$$;

-- Every due period of every active schedule in one workspace. Each schedule
-- is its own sub-transaction: a broken template is skipped (with a warning)
-- instead of stopping the rest. Rows another run holds are skipped, not
-- waited on — that run is already doing the work.
--
-- One call is bounded: at most per_schedule invoices per schedule and
-- per_run in all. A schedule that hits its limit keeps next_run_on at the
-- first period not yet made, so the next run (the next page load, or the
-- nightly job) carries on from there — every call does a bounded amount of
-- work, and a statement timeout can't roll a long catch-up back forever.
-- (0027 also stops the API setting a next run more than a year back.)
create or replace function private.run_recurring(p_workspace text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  per_schedule constant integer := 24;
  per_run      constant integer := 240;
  s       public.invoice_schedules;
  today   date := public.local_today();
  run_on  date;
  n       integer;
  last_id uuid;
  made    integer := 0;
  mine    integer;
begin
  for s in
    select * from public.invoice_schedules
    where workspace = p_workspace and active and next_run_on <= today
    order by next_run_on, created_at
    for update skip locked
  loop
    exit when made >= per_run;
    begin
      run_on := s.next_run_on;
      n := s.occurrences;
      last_id := null;
      mine := 0;
      while run_on <= today
        and mine < least(per_schedule, per_run - made)
        and (s.ends_on is null or run_on <= s.ends_on)
        and (s.max_occurrences is null or n < s.max_occurrences)
      loop
        if not exists (select 1 from public.invoices where schedule_id = s.id and period_start = run_on) then
          last_id := private.generate_scheduled_invoice(s, run_on);
          n := n + 1;
          mine := mine + 1;
        end if;
        run_on := private.next_run_after(s.anchor_date, s.frequency, s.interval_count, run_on);
      end loop;

      if run_on is distinct from s.next_run_on or n <> s.occurrences or last_id is not null then
        update public.invoice_schedules
        set next_run_on = run_on, occurrences = n, last_invoice_id = coalesce(last_id, last_invoice_id)
        where id = s.id;
      end if;
      made := made + mine;
    exception when others then
      raise warning 'Recurring schedule % (%) skipped: %', s.id, s.name, sqlerrm;
    end;
  end loop;
  return made;
end;
$$;

-- For pg_cron: every workspace, no caller.
create or replace function private.run_recurring_all()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  ws   text;
  made integer := 0;
begin
  for ws in select id from public.workspaces order by id loop
    made := made + private.run_recurring(ws);
  end loop;
  return made;
end;
$$;

revoke execute on function private.next_run_after(date, text, integer, date),
  private.generate_scheduled_invoice(public.invoice_schedules, date),
  private.run_recurring(text), private.run_recurring_all()
  from public, anon, authenticated;

-- The app's entry point ("Generate now", and every invoice page load): the
-- caller's workspace only. Definer because a run issues numbers and writes
-- rows the caller couldn't (auto-issue on an admin's schedule).
create or replace function public.run_recurring_invoices()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_access('invoices') then
    raise exception 'You don''t have access to Invoices.' using errcode = '42501';
  end if;
  return private.run_recurring(public.current_workspace());
end;
$$;

revoke execute on function public.run_recurring_invoices() from public, anon, authenticated;
grant execute on function public.run_recurring_invoices() to authenticated, service_role;

-- ──────────────────────── people's date changes ─────────────────────────────
-- A run bills every period from next_run_on to today, stepping from the
-- anchor. Two edits would make that bill the wrong periods, whichever path
-- writes them (the editor, the quick edit, the template editor, the API):
--
--  · Resuming a paused schedule. Its next_run_on is still where it stopped,
--    so the next run would bill every month it was paused. Resuming skips
--    those and moves to the first run date from today (today's own period is
--    kept when today is a run date).
--  · A next run off the anchor's cadence ("move billing from the 15th to the
--    1st"). Runs step from the anchor, so that date would be billed once and
--    the one after would snap back to the 15th — two invoices a fortnight
--    apart. The cadence restarts from the new date instead. A date on the
--    cadence keeps the anchor, so a Jan 31 schedule moved to Apr 30 still
--    runs on May 31.
--
-- The run's own updates always land on the cadence and never resume, so they
-- pass through unchanged. Definer because private.next_run_after is out of an
-- API caller's reach; it only ever rewrites the row being saved. Named to fire
-- after invoice_schedules_guard (triggers fire in name order).
create or replace function private.schedule_run_dates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := public.local_today();
begin
  -- not null rejects these right after; next_run_after can't step from a null
  if new.anchor_date is null or new.next_run_on is null then
    return new;
  end if;

  if new.next_run_on <> private.next_run_after(new.anchor_date, new.frequency, new.interval_count, new.next_run_on - 1) then
    new.anchor_date := new.next_run_on;
  end if;

  if tg_op = 'UPDATE' and not old.active and new.active and new.next_run_on < today then
    new.next_run_on := private.next_run_after(new.anchor_date, new.frequency, new.interval_count, today - 1);
  end if;
  return new;
end;
$$;

revoke execute on function private.schedule_run_dates() from public, anon, authenticated;

drop trigger if exists invoice_schedules_zdates on public.invoice_schedules;
create trigger invoice_schedules_zdates
  before insert or update on public.invoice_schedules
  for each row execute function private.schedule_run_dates();

-- "Make recurring" saves an invoice and starts a schedule from it: that
-- invoice is the first of the series. The app inserts the schedule with
-- occurrences = 1 (so "stops after N invoices" means N, this one included)
-- and links the invoice here, so its page stops offering to make it
-- recurring again. guard_scheduled_invoice keeps the API off schedule_id /
-- period_start; this is the one narrow way on, for exactly that pair — a
-- schedule that has counted only this invoice and points at it. Definer
-- because those columns are run-only; access and workspace checked here.
create or replace function public.link_first_scheduled_invoice(p_schedule uuid, p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ws  text := public.current_workspace();
  s   public.invoice_schedules;
  inv public.invoices;
begin
  if not public.can_access('invoices') then
    raise exception 'You don''t have access to Invoices.' using errcode = '42501';
  end if;

  select * into s from public.invoice_schedules where id = p_schedule and workspace = ws for update;
  select * into inv from public.invoices where id = p_invoice and workspace = ws for update;
  if s.id is null or inv.id is null then
    raise exception 'That schedule or invoice isn''t available.' using errcode = 'no_data_found';
  end if;
  if s.last_invoice_id is distinct from inv.id or s.occurrences <> 1
     or inv.kind <> 'invoice' or inv.schedule_id is not null then
    raise exception 'Only a new schedule''s first invoice can be linked to it.' using errcode = 'check_violation';
  end if;

  -- The period it covers is its own issue date; runs start at next_run_on.
  update public.invoices set schedule_id = s.id, period_start = inv.issue_date where id = inv.id;
end;
$$;

revoke execute on function public.link_first_scheduled_invoice(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_first_scheduled_invoice(uuid, uuid) to authenticated, service_role;

-- ─────────────────────────────── pg_cron ───────────────────────────────────
-- 02:30 UTC = 08:00 in Colombo. Projects without pg_cron (and the local
-- harness) skip this quietly; the pages still run the catch-up on load.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    null;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('flowstate-recurring', '30 2 * * *', 'select private.run_recurring_all()');
  end if;
exception when others then
  raise notice 'flowstate-recurring not scheduled: %', sqlerrm;
end $$;
