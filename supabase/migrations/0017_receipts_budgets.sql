-- ============================================================================
-- 0017 · Receipts & budgets
-- Receipts: images and PDFs kept in the private Storage bucket `receipts`,
-- one folder per entry — `<workspace>/<entry_id>/<file>`. finance_attachments
-- is the index the ledger reads (name, type, size); the bytes stay in Storage
-- and are only ever handed out through short-lived signed URLs. Storage
-- policies key off the first folder, so the demo can never read or write a
-- live receipt, and only people with Expenses can touch the bucket at all.
--
-- Budgets: one spending limit per category and period (monthly, quarterly,
-- yearly — Colombo calendar). budget_status shows each budget against the
-- approved expenses of its current period. Reaching the alert % ("warn") and
-- going over 100% ("over") alerts everyone with Expenses, once per level per
-- period (budget_alerts remembers what was sent, so going back under and over
-- again stays quiet). Pending and rejected expenses (0016) never count.
--
-- The Storage part is skipped where there's no storage schema; on Supabase
-- it creates the bucket and its policies.
-- Requires: 0016
-- ============================================================================

-- ───────────────────────────── receipt index ────────────────────────────────
create table if not exists public.finance_attachments (
  id           uuid primary key default gen_random_uuid(),
  workspace    text not null default public.current_workspace() references public.workspaces (id),
  entry_id     uuid not null references public.finance_entries (id) on delete cascade,
  storage_path text not null unique,         -- object name in the receipts bucket
  file_name    text,
  mime_type    text,
  size_bytes   integer,
  uploaded_by  uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.finance_attachments is
  'Receipts on ledger entries. The files live in the private `receipts` bucket at <workspace>/<entry_id>/<file>.';

-- Same limits as the bucket.
alter table public.finance_attachments drop constraint if exists finance_attachments_values_check;
alter table public.finance_attachments
  add constraint finance_attachments_values_check check (
    (size_bytes is null or size_bytes between 0 and 10485760)
    and (mime_type is null or mime_type ~ '^image/' or mime_type = 'application/pdf')
  );

create index if not exists finance_attachments_entry_idx on public.finance_attachments (entry_id);
create index if not exists finance_attachments_workspace_idx on public.finance_attachments (workspace);

-- A receipt lives in its entry's workspace, in that entry's folder (definer:
-- the fence then judges the result, so a demo caller can't file a receipt
-- against a live entry, or point a row at someone else's object).
create or replace function private.finance_attachment_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  folder text;
begin
  if tg_op = 'UPDATE' and new.entry_id is distinct from old.entry_id then
    raise exception 'A receipt can''t move to another entry.' using errcode = 'check_violation';
  end if;
  new.workspace := (select f.workspace from public.finance_entries f where f.id = new.entry_id);
  if new.workspace is null then
    raise exception 'That entry doesn''t exist.' using errcode = 'foreign_key_violation';
  end if;
  folder := new.workspace || '/' || new.entry_id || '/';
  if left(new.storage_path, length(folder)) <> folder or length(new.storage_path) <= length(folder) then
    raise exception 'Receipts are stored in their entry''s folder.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Like private.stamp_created_by: from the API the uploader is the caller, for good.
create or replace function private.stamp_uploaded_by()
returns trigger
language plpgsql
security invoker
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'anon') then
      new.uploaded_by := auth.uid();
    else
      new.uploaded_by := coalesce(new.uploaded_by, auth.uid());
    end if;
  elsif current_user in ('authenticated', 'anon') then
    new.uploaded_by := old.uploaded_by;
  end if;
  return new;
end;
$$;

revoke execute on function private.finance_attachment_workspace(), private.stamp_uploaded_by()
  from public, anon, authenticated;

drop trigger if exists finance_attachments_workspace on public.finance_attachments;
create trigger finance_attachments_workspace
  before insert or update on public.finance_attachments
  for each row execute function private.finance_attachment_workspace();

drop trigger if exists finance_attachments_stamp_uploader on public.finance_attachments;
create trigger finance_attachments_stamp_uploader
  before insert or update on public.finance_attachments
  for each row execute function private.stamp_uploaded_by();

-- Logged against the entry, so the line links to the ledger. Receipts that
-- leave with their entry (the foreign-key cascade, which fires at the same
-- trigger depth) are part of that deletion, not a change of their own.
create or replace function private.log_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r     public.finance_attachments := coalesce(new, old);
  entry text;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  select f.description into entry from public.finance_entries f where f.id = r.entry_id;
  if not found then
    return null;
  end if;
  perform private.log_event(
    r.workspace,
    case when tg_op = 'INSERT' then 'receipt_added' else 'receipt_removed' end,
    'entry', r.entry_id, entry,
    format(case when tg_op = 'INSERT' then 'attached receipt “%s” to “%s”' else 'removed receipt “%s” from “%s”' end,
           left(coalesce(r.file_name, 'file'), 80), left(entry, 80))
  );
  return null;
end;
$$;

revoke execute on function private.log_receipt() from public, anon, authenticated;

drop trigger if exists finance_attachments_activity on public.finance_attachments;
create trigger finance_attachments_activity
  after insert or delete on public.finance_attachments
  for each row execute function private.log_receipt();

alter table public.finance_attachments enable row level security;

drop policy if exists "workspace fence" on public.finance_attachments;
create policy "workspace fence" on public.finance_attachments as restrictive for all to authenticated
  using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
  with check (workspace = (select public.current_workspace()) and (select public.is_active_member()));

-- Follows the entry as the caller sees it.
drop policy if exists "finance attachments: module" on public.finance_attachments;
create policy "finance attachments: module"
  on public.finance_attachments for all to authenticated
  using ((select public.can_access('finance'))
         and exists (select 1 from public.finance_entries f where f.id = entry_id))
  with check ((select public.can_access('finance'))
              and exists (select 1 from public.finance_entries f where f.id = entry_id));

-- Attached or removed, never rewritten.
revoke all on public.finance_attachments from anon;
revoke update on public.finance_attachments from authenticated;

-- ─────────────────────────────── budgets ───────────────────────────────────
create table if not exists public.budgets (
  id            uuid primary key default gen_random_uuid(),
  workspace     text not null default public.current_workspace() references public.workspaces (id),
  category      text not null,               -- matched to finance_entries.category, case-insensitively
  period        text not null default 'monthly',
  amount        numeric(14, 2) not null,     -- LKR per period
  alert_percent integer not null default 80,
  active        boolean not null default true,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.budgets is
  'Spending limits per expense category and period. Approved expenses only; see budget_status.';

alter table public.budgets drop constraint if exists budgets_period_check;
alter table public.budgets
  add constraint budgets_period_check check (period in ('monthly', 'quarterly', 'yearly'));

alter table public.budgets drop constraint if exists budgets_values_check;
alter table public.budgets
  add constraint budgets_values_check check (
    btrim(category) <> '' and amount > 0 and alert_percent between 1 and 100
  );

-- One budget per category and period. "Software" and "software " would count
-- the same expenses, so they're the same category here too.
create unique index if not exists budgets_category_period_key
  on public.budgets (workspace, lower(btrim(category)), period);
create index if not exists budgets_workspace_idx on public.budgets (workspace);

drop trigger if exists budgets_set_updated_at on public.budgets;
create trigger budgets_set_updated_at
  before update on public.budgets
  for each row execute function public.set_updated_at();

drop trigger if exists budgets_stamp_created_by on public.budgets;
create trigger budgets_stamp_created_by
  before insert or update on public.budgets
  for each row execute function private.stamp_created_by();

drop trigger if exists budgets_activity on public.budgets;
create trigger budgets_activity
  after insert or update or delete on public.budgets
  for each row execute function private.log_activity('budget', 'category', '{}');

alter table public.budgets enable row level security;

drop policy if exists "workspace fence" on public.budgets;
create policy "workspace fence" on public.budgets as restrictive for all to authenticated
  using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
  with check (workspace = (select public.current_workspace()) and (select public.is_active_member()));

-- Everyone with Expenses sees the budgets; admins set them.
drop policy if exists "budgets: finance reads" on public.budgets;
create policy "budgets: finance reads"
  on public.budgets for select to authenticated
  using ((select public.can_access('finance')));

drop policy if exists "budgets: admins manage" on public.budgets;
create policy "budgets: admins manage"
  on public.budgets for all to authenticated
  using ((select public.can_access('finance')) and (select public.is_admin()))
  with check ((select public.can_access('finance')) and (select public.is_admin()));

revoke all on public.budgets from anon;

-- ─────────────────────────── alerts already sent ────────────────────────────
create table if not exists public.budget_alerts (
  budget_id    uuid not null references public.budgets (id) on delete cascade,
  period_start date not null,
  level        text not null,
  workspace    text not null default public.current_workspace() references public.workspaces (id),
  sent_at      timestamptz not null default now(),
  primary key (budget_id, period_start, level)
);

comment on table public.budget_alerts is
  'One row per budget, period and level (warn / over) already alerted. Written by triggers only.';

alter table public.budget_alerts drop constraint if exists budget_alerts_level_check;
alter table public.budget_alerts
  add constraint budget_alerts_level_check check (level in ('warn', 'over'));

create index if not exists budget_alerts_workspace_idx on public.budget_alerts (workspace);

alter table public.budget_alerts enable row level security;

drop policy if exists "workspace fence" on public.budget_alerts;
create policy "workspace fence" on public.budget_alerts as restrictive for all to authenticated
  using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
  with check (workspace = (select public.current_workspace()) and (select public.is_active_member()));

drop policy if exists "budget alerts: finance reads" on public.budget_alerts;
create policy "budget alerts: finance reads"
  on public.budget_alerts for select to authenticated
  using ((select public.can_access('finance')));

revoke all on public.budget_alerts from anon;
revoke insert, update, delete, truncate on public.budget_alerts from authenticated;

-- ──────────────────────────── budget_status ─────────────────────────────────
-- Each budget against its current Colombo period. period_end is inclusive;
-- percent has one decimal. Read under the caller's RLS.
create or replace view public.budget_status
with (security_invoker = on) as
select
  b.id,
  b.category,
  b.period,
  b.amount,
  b.alert_percent,
  b.active,
  p.period_start,
  p.period_end,
  coalesce(s.spent, 0)::numeric(14, 2)                   as spent,
  round(coalesce(s.spent, 0) * 100 / b.amount, 1)        as percent
from public.budgets b
cross join lateral (
  select t::date as period_start,
         (t + case b.period when 'quarterly' then interval '3 months'
                            when 'yearly' then interval '1 year'
                            else interval '1 month' end)::date - 1 as period_end
  from date_trunc(
    case b.period when 'quarterly' then 'quarter' when 'yearly' then 'year' else 'month' end,
    public.local_today()::timestamp
  ) as t
) p
left join lateral (
  select sum(f.amount) as spent
  from public.finance_entries f
  where f.workspace = b.workspace
    and f.kind = 'expense'
    and f.approval_status = 'approved'
    and lower(btrim(f.category)) = lower(btrim(b.category))
    and f.entry_date between p.period_start and p.period_end
) s on true;

revoke all on public.budget_status from anon;
grant select on public.budget_status to authenticated;

-- ─────────────────────────────── alerts ────────────────────────────────────
-- Records every level a budget has reached this period and alerts the
-- highest new one — straight past 100% is one "over" alert, not two. Exactly
-- 100% is used up, not over (the Budgets screen draws it the same way). From
-- the system (no actor), so whoever pushed it over hears too.
create or replace function private.check_budgets(p_workspace text, p_categories text[] default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b      record;
  fired  integer;
  period text;
begin
  for b in
    select s.*
    from public.budget_status s
    join public.budgets bu on bu.id = s.id
    where bu.workspace = p_workspace
      and s.active
      and s.spent * 100 >= s.amount * s.alert_percent
      and (p_categories is null or lower(btrim(s.category)) = any (p_categories))
  loop
    if b.spent > b.amount then
      insert into public.budget_alerts (budget_id, period_start, level, workspace)
      values (b.id, b.period_start, 'over', p_workspace)
      on conflict do nothing;
      get diagnostics fired = row_count;
      insert into public.budget_alerts (budget_id, period_start, level, workspace)
      values (b.id, b.period_start, 'warn', p_workspace)
      on conflict do nothing;
    else
      insert into public.budget_alerts (budget_id, period_start, level, workspace)
      values (b.id, b.period_start, 'warn', p_workspace)
      on conflict do nothing;
      get diagnostics fired = row_count;
    end if;
    continue when fired = 0;

    period := case b.period
      when 'monthly' then to_char(b.period_start, 'FMMonth YYYY')
      when 'quarterly' then to_char(b.period_start, '"Q"Q YYYY')
      else to_char(b.period_start, 'YYYY')
    end;
    perform private.notify(
      array(select private.users_with_access('finance', p_workspace)),
      p_workspace,
      'budget_alert',
      case when b.spent > b.amount
           then format('Over budget · %s', b.category)
           else format('Budget at %s%% · %s', floor(b.spent * 100 / b.amount)::integer, b.category) end,
      format('%s of %s spent · %s', private.rupees(b.spent), private.rupees(b.amount), period),
      '/admin/expenses/budgets',
      'budget', b.id,
      now(),
      null
    );
  end loop;
end;
$$;

-- Only approved spend can push a budget up; deletes and refunds only lower it.
create or replace function private.watch_budget_spend()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'expense' or new.approval_status <> 'approved' then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.kind, new.amount, new.category, new.entry_date, new.approval_status, new.workspace)
         is not distinct from (old.kind, old.amount, old.category, old.entry_date, old.approval_status, old.workspace) then
    return null;
  end if;
  perform private.check_budgets(new.workspace, array[lower(btrim(new.category))]);
  return null;
end;
$$;

-- A new budget, a lower limit or alert %, or a reactivated one can be over already.
create or replace function private.watch_budget()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.active then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.amount, new.alert_percent, new.active, new.category, new.period)
         is not distinct from (old.amount, old.alert_percent, old.active, old.category, old.period) then
    return null;
  end if;
  perform private.check_budgets(new.workspace, array[lower(btrim(new.category))]);
  return null;
end;
$$;

revoke execute on function private.check_budgets(text, text[]), private.watch_budget_spend(), private.watch_budget()
  from public, anon, authenticated;

drop trigger if exists finance_entries_budget on public.finance_entries;
create trigger finance_entries_budget
  after insert or update on public.finance_entries
  for each row execute function private.watch_budget_spend();

drop trigger if exists budgets_alert on public.budgets;
create trigger budgets_alert
  after insert or update on public.budgets
  for each row execute function private.watch_budget();

-- ─────────────────────────────── Storage ───────────────────────────────────
-- The bucket and its policies, where Supabase Storage exists. Objects are
-- named <workspace>/<entry_id>/<file>: the first folder must be the caller's
-- workspace, and a new upload must sit under an entry the caller can see.
-- Removing doesn't need the entry — the app deletes the entry, then its files.
do $$
begin
  if to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null
     or to_regprocedure('storage.foldername(text)') is null then
    raise notice 'No Supabase Storage here — the receipts bucket was not set up.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('receipts', 'receipts', false, 10485760, array['image/*', 'application/pdf'])
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  begin
    drop policy if exists "receipts: finance reads" on storage.objects;
    create policy "receipts: finance reads"
      on storage.objects for select to authenticated
      using (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = (select public.current_workspace())
        and (select public.can_access('finance'))
      );

    drop policy if exists "receipts: finance uploads" on storage.objects;
    create policy "receipts: finance uploads"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = (select public.current_workspace())
        and (select public.can_access('finance'))
        and exists (
          select 1 from public.finance_entries f
          where f.id = case when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                            then ((storage.foldername(name))[2])::uuid end
        )
      );

    drop policy if exists "receipts: finance deletes" on storage.objects;
    create policy "receipts: finance deletes"
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = (select public.current_workspace())
        and (select public.can_access('finance'))
      );
  exception when insufficient_privilege then
    raise warning 'Receipts bucket created, but its storage policies could not be: % — add them in Storage → Policies.', sqlerrm;
  end;
end $$;
