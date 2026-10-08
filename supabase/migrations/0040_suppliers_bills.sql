-- ============================================================================
-- 0040 · Suppliers and bills
-- What the business owes, before it's paid: suppliers, their bills (with the
-- tax they charged — input tax for the tax report), payments against them,
-- and recurring expenses (rent, subscriptions) that raise a bill on schedule.
--
--   suppliers — name, contact, TIN, a default category. Archived, not
--     deleted, once they have bills.
--   bills — a supplier's bill: reference, dates, currency (+ rate), the amount
--     before tax, the taxes on it as billed, the ledger category its payments
--     go to. Status follows the payments: draft · open · partially_paid ·
--     paid · void.
--   bill_payments — paying a bill posts an expense to the ledger in rupees
--     (like invoice payments post income, 0013); removing the payment removes
--     the expense. Those ledger lines belong to the bill.
--   bill_schedules — "every month, Rs 150,000 rent to Lanka Properties": each
--     due period becomes an open bill (once — unique per schedule and period),
--     when Bills opens, from the hourly job, or from pg_cron if it's there.
--   Cash flow (0022 → 0031) counts open bills and upcoming schedule runs as
--     money going out; the tax report (0033) gets input tax from bills.
-- Everything here is the Expenses module's (can_access('finance')).
-- Requires: 0039. Idempotent.
-- ============================================================================

-- ─────────────────────────────── suppliers ─────────────────────────────────
create table if not exists public.suppliers (
  id               uuid primary key default gen_random_uuid(),
  workspace        text not null default public.current_workspace() references public.workspaces (id),
  name             text not null,
  contact_name     text,
  email            text,
  phone            text,
  address          text,
  tax_id           text,
  default_category text,
  notes            text,
  active           boolean not null default true,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.suppliers is 'Who the business buys from (0040).';

alter table public.suppliers drop constraint if exists suppliers_values_check;
alter table public.suppliers
  add constraint suppliers_values_check check (
    btrim(name) <> '' and char_length(name) <= 200
    and (tax_id is null or char_length(tax_id) <= 40)
    and (notes is null or char_length(notes) <= 4000)
  );

create index if not exists suppliers_workspace_idx on public.suppliers (workspace, active, name);

-- ───────────────────────────────── bills ───────────────────────────────────
create table if not exists public.bills (
  id             uuid primary key default gen_random_uuid(),
  workspace      text not null default public.current_workspace() references public.workspaces (id),
  supplier_id    uuid not null references public.suppliers (id) on delete restrict,
  reference      text,
  bill_date      date not null default public.local_today(),
  due_date       date,
  currency       text not null default 'LKR',
  exchange_rate  numeric(18, 6),
  description    text,
  category       text not null default 'Other',
  subtotal       numeric(14, 2) not null default 0,
  tax_breakdown  jsonb not null default '[]'::jsonb,
  tax_total      numeric(14, 2) not null default 0,
  total          numeric(14, 2) not null default 0,
  amount_paid    numeric(14, 2) not null default 0,
  balance_due    numeric(14, 2) generated always as (total - amount_paid) stored,
  status         text not null default 'open',
  notes          text,
  schedule_id    uuid,
  period_start   date,
  paid_at        timestamptz,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.bills is
  'Supplier bills (0040). Totals, amount_paid and status are kept by private.bill_totals.';

alter table public.bills drop constraint if exists bills_values_check;
alter table public.bills
  add constraint bills_values_check check (
    status in ('draft', 'open', 'partially_paid', 'paid', 'void')
    and subtotal >= 0
    and currency ~ '^[A-Z]{3}$'
    and (exchange_rate is null or exchange_rate > 0)
    and jsonb_typeof(tax_breakdown) = 'array' and jsonb_array_length(tax_breakdown) <= 4
    and btrim(category) <> ''
    and (reference is null or char_length(reference) <= 80)
    and (due_date is null or due_date >= bill_date)
    and amount_paid between 0 and total
  );

create index if not exists bills_workspace_idx on public.bills (workspace, status, due_date);
create index if not exists bills_supplier_idx on public.bills (supplier_id);

-- ────────────────────────────── bill payments ──────────────────────────────
create table if not exists public.bill_payments (
  id           uuid primary key default gen_random_uuid(),
  workspace    text not null default public.current_workspace() references public.workspaces (id),
  bill_id      uuid not null references public.bills (id) on delete cascade,
  amount       numeric(14, 2) not null,
  amount_base  numeric(14, 2),
  paid_on      date not null default public.local_today(),
  method       text,
  reference    text,
  note         text,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.bill_payments is 'Payments against supplier bills (0040); each posts an expense in LKR.';

alter table public.bill_payments drop constraint if exists bill_payments_values_check;
alter table public.bill_payments
  add constraint bill_payments_values_check check (amount > 0 and (amount_base is null or amount_base > 0));

create index if not exists bill_payments_bill_idx on public.bill_payments (bill_id);

-- Ledger lines a bill payment posted.
alter table public.finance_entries add column if not exists bill_id uuid references public.bills (id) on delete set null;
alter table public.finance_entries
  add column if not exists bill_payment_id uuid unique references public.bill_payments (id) on delete cascade;

comment on column public.finance_entries.bill_payment_id is
  'Set on an expense posted by a bill payment. Such rows change only through the payment.';

-- ───────────────────────────── recurring bills ─────────────────────────────
create table if not exists public.bill_schedules (
  id             uuid primary key default gen_random_uuid(),
  workspace      text not null default public.current_workspace() references public.workspaces (id),
  supplier_id    uuid not null references public.suppliers (id) on delete cascade,
  name           text not null,
  description    text,
  category       text not null default 'Other',
  amount         numeric(14, 2) not null,
  tax_breakdown  jsonb not null default '[]'::jsonb,
  currency       text not null default 'LKR',
  frequency      text not null default 'monthly',
  interval_count integer not null default 1,
  anchor_date    date not null default public.local_today(),
  next_run_on    date not null default public.local_today(),
  due_days       integer not null default 0,
  ends_on        date,
  active         boolean not null default true,
  last_bill_id   uuid references public.bills (id) on delete set null,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.bill_schedules is 'Recurring expenses that raise a bill each period (0040).';

alter table public.bill_schedules drop constraint if exists bill_schedules_values_check;
alter table public.bill_schedules
  add constraint bill_schedules_values_check check (
    btrim(name) <> '' and amount > 0 and currency ~ '^[A-Z]{3}$'
    and frequency in ('weekly', 'monthly', 'quarterly', 'yearly')
    and interval_count between 1 and 24
    and due_days between 0 and 120
    and jsonb_typeof(tax_breakdown) = 'array' and jsonb_array_length(tax_breakdown) <= 4
    and (ends_on is null or ends_on >= anchor_date)
  );

alter table public.bills drop constraint if exists bills_schedule_id_fkey;
alter table public.bills add constraint bills_schedule_id_fkey
  foreign key (schedule_id) references public.bill_schedules (id) on delete set null;
create unique index if not exists bills_schedule_period_key on public.bills (schedule_id, period_start)
  where schedule_id is not null;

-- ─────────────────────────────── triggers ──────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['suppliers', 'bills', 'bill_schedules'] loop
    execute format('drop trigger if exists %1$s_set_updated_at on public.%1$I', t);
    execute format('create trigger %1$s_set_updated_at before update on public.%1$I for each row execute function public.set_updated_at()', t);
    execute format('drop trigger if exists %1$s_stamp on public.%1$I', t);
    execute format('create trigger %1$s_stamp before insert on public.%1$I for each row execute function private.stamp_created_by()', t);
  end loop;
end;
$$;

drop trigger if exists bill_payments_stamp on public.bill_payments;
create trigger bill_payments_stamp
  before insert on public.bill_payments
  for each row execute function private.stamp_created_by();

drop trigger if exists suppliers_activity on public.suppliers;
create trigger suppliers_activity after insert or update or delete on public.suppliers
  for each row execute function private.log_activity('supplier', 'name', '');
drop trigger if exists bills_activity on public.bills;
create trigger bills_activity after insert or update or delete on public.bills
  for each row execute function private.log_activity('bill', 'reference', '{subtotal,tax_total,total,amount_paid,balance_due,paid_at}');

-- A bill's taxes as billed: [{name, rate, amount}] — names and amounts kept
-- as the supplier printed them; nothing negative, four at most.
create or replace function private.clean_bill_taxes(p jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  e    jsonb;
  out_ jsonb := '[]'::jsonb;
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p) <> 'array' then
    raise exception 'Taxes must be a list.' using errcode = '22023';
  end if;
  for e in select x from jsonb_array_elements(p) t(x) loop
    if nullif(btrim(e ->> 'name'), '') is null then
      raise exception 'Each tax needs a name.' using errcode = 'check_violation';
    end if;
    if coalesce(e ->> 'amount', '') !~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then
      raise exception 'Tax amounts can''t be negative.' using errcode = 'check_violation';
    end if;
    out_ := out_ || jsonb_build_array(jsonb_build_object(
      'name', left(btrim(e ->> 'name'), 40),
      'rate', case when coalesce(e ->> 'rate', '') ~ '^\s*[0-9]{1,3}(\.[0-9]+)?\s*$' then round((e ->> 'rate')::numeric, 3) end,
      'amount', round((e ->> 'amount')::numeric, 2)));
  end loop;
  return out_;
end;
$$;

revoke execute on function private.clean_bill_taxes(jsonb) from public, anon, authenticated;

-- Totals, payments and status. A rupee bill carries no rate.
create or replace function private.bill_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.currency = 'LKR' then
    new.exchange_rate := null;
  end if;
  new.tax_breakdown := private.clean_bill_taxes(new.tax_breakdown);
  new.tax_total := coalesce((select sum((x ->> 'amount')::numeric) from jsonb_array_elements(new.tax_breakdown) t(x)), 0);
  new.total := new.subtotal + new.tax_total;
  select coalesce(sum(p.amount), 0) into new.amount_paid from public.bill_payments p where p.bill_id = new.id;
  if new.amount_paid > new.total then
    raise exception 'The total can''t drop below the % already paid. Remove a payment first.',
      private.money(new.amount_paid, new.currency) using errcode = 'check_violation';
  end if;
  if new.status not in ('draft', 'void') then
    new.status := case when new.amount_paid >= new.total and new.total > 0 then 'paid'
                       when new.amount_paid > 0 then 'partially_paid'
                       else 'open' end;
  end if;
  new.paid_at := case when new.status = 'paid' then coalesce(case when tg_op = 'UPDATE' then old.paid_at end, now()) end;
  return new;
end;
$$;

revoke execute on function private.bill_totals() from public, anon, authenticated;

drop trigger if exists bills_totals on public.bills;
create trigger bills_totals
  before insert or update on public.bills
  for each row execute function private.bill_totals();

-- What the API may do to a bill: void it only without payments; delete only
-- drafts and open ones without payments; the supplier and currency stay once
-- something's paid.
create or replace function private.guard_bills()
returns trigger
language plpgsql
security invoker
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if old.amount_paid > 0 then
      raise exception 'Remove its payments before deleting the bill.' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'void' and new.status = 'void' then
      raise exception 'A void bill can''t be changed.' using errcode = 'check_violation';
    end if;
    if new.status = 'void' and old.amount_paid > 0 then
      raise exception 'Remove its payments before voiding it.' using errcode = 'check_violation';
    end if;
    if old.amount_paid > 0 and (new.currency, new.supplier_id) is distinct from (old.currency, old.supplier_id) then
      raise exception 'Supplier and currency are locked once a payment is recorded.' using errcode = 'check_violation';
    end if;
  end if;
  if new.status not in ('draft', 'void') then
    new.status := 'open';  -- the totals trigger works out paid / part paid
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_bills() from public, anon, authenticated;

drop trigger if exists bills_guard on public.bills;
create trigger bills_guard
  before insert or update or delete on public.bills
  for each row execute function private.guard_bills();

-- Child rows live in their bill's workspace; a payment needs an open bill and
-- can't pay more than is left; its rupee amount is the bill's rate × amount
-- when not given.
create or replace function private.check_bill_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b     public.bills;
  other numeric(14, 2);
begin
  if tg_op = 'UPDATE' and new.bill_id is distinct from old.bill_id then
    raise exception 'A payment can''t move to another bill.' using errcode = 'check_violation';
  end if;
  select * into b from public.bills where id = new.bill_id for update;
  if not found then
    raise exception 'That bill doesn''t exist.' using errcode = 'foreign_key_violation';
  end if;
  new.workspace := b.workspace;
  if b.status not in ('open', 'partially_paid', 'paid') then
    raise exception 'Payments go on an open bill.' using errcode = 'check_violation';
  end if;
  if b.currency = 'LKR' then
    new.amount_base := new.amount;
  elsif new.amount_base is null and b.exchange_rate is not null then
    new.amount_base := round(new.amount * b.exchange_rate, 2);
  elsif new.amount_base is null then
    raise exception 'Enter the amount in rupees — the ledger is kept in LKR.' using errcode = 'check_violation';
  end if;
  select coalesce(sum(p.amount), 0) into other from public.bill_payments p where p.bill_id = b.id and p.id <> new.id;
  if other + new.amount > b.total then
    raise exception 'That''s more than the % left to pay.', private.money(b.total - other, b.currency)
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_bill_payment() from public, anon, authenticated;

drop trigger if exists bill_payments_check on public.bill_payments;
create trigger bill_payments_check
  before insert or update on public.bill_payments
  for each row execute function private.check_bill_payment();

-- The expense a payment posts ("Bill · INV-778 · Lanka Properties"), and the
-- bill's totals brought up to date.
create or replace function private.post_bill_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pay public.bill_payments := coalesce(new, old);
  b   public.bills;
  sup public.suppliers;
begin
  select * into b from public.bills where id = pay.bill_id;
  if not found then
    return null;
  end if;
  if tg_op <> 'DELETE' then
    select * into sup from public.suppliers where id = b.supplier_id;
    insert into public.finance_entries
      (workspace, kind, entry_date, description, category, amount, currency, method, reference, bill_id, bill_payment_id, created_by)
    values
      (b.workspace, 'expense', new.paid_on,
       concat_ws(' · ', 'Bill', nullif(btrim(b.reference), ''), sup.name),
       b.category, new.amount_base, 'LKR', new.method, coalesce(nullif(btrim(new.reference), ''), b.reference),
       b.id, new.id, new.created_by)
    on conflict (bill_payment_id) do update
      set entry_date = excluded.entry_date, description = excluded.description, category = excluded.category,
          amount = excluded.amount, method = excluded.method, reference = excluded.reference;
  end if;
  update public.bills set updated_at = now() where id = b.id;
  return null;
end;
$$;

revoke execute on function private.post_bill_payment() from public, anon, authenticated;

drop trigger if exists bill_payments_post on public.bill_payments;
create trigger bill_payments_post
  after insert or update or delete on public.bill_payments
  for each row execute function private.post_bill_payment();

-- Expenses a bill payment posted belong to the payment.
create or replace function private.guard_bill_expense()
returns trigger
language plpgsql
security invoker
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op <> 'INSERT' and old.bill_payment_id is not null then
    raise exception 'This expense belongs to a bill payment — change it from Bills.' using errcode = 'check_violation';
  end if;
  if tg_op <> 'DELETE' and (new.bill_payment_id is not null or new.bill_id is not null) then
    raise exception 'Bill payments post their own expenses — record the payment on the bill.' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function private.guard_bill_expense() from public, anon, authenticated;

drop trigger if exists finance_entries_guard_bill on public.finance_entries;
create trigger finance_entries_guard_bill
  before insert or update or delete on public.finance_entries
  for each row execute function private.guard_bill_expense();

-- ─────────────────────────────── policies ──────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['suppliers', 'bills', 'bill_payments', 'bill_schedules'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "workspace fence" on public.%I', t);
    execute format($p$create policy "workspace fence" on public.%I as restrictive for all to authenticated
      using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
      with check (workspace = (select public.current_workspace()) and (select public.is_active_member()))$p$, t);
    execute format('drop policy if exists "%1$s: module" on public.%1$I', t);
    execute format($p$create policy "%1$s: module" on public.%1$I for all to authenticated
      using ((select public.can_access('finance'))) with check ((select public.can_access('finance')))$p$, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end;
$$;

-- ───────────────────────────── generating bills ────────────────────────────
-- Every due period of every active schedule in a workspace becomes an open
-- bill (once). Returns how many were made.
create or replace function private.run_bill_schedules(p_workspace text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s     public.bill_schedules;
  run_on date;
  made  integer := 0;
  v_id  uuid;
  today date := public.local_today();
begin
  for s in
    select * from public.bill_schedules
    where workspace = p_workspace and active and next_run_on <= today
    for update skip locked
  loop
    run_on := s.next_run_on;
    while run_on <= today and (s.ends_on is null or run_on <= s.ends_on) loop
      insert into public.bills (workspace, supplier_id, bill_date, due_date, currency, description, category,
                                subtotal, tax_breakdown, status, schedule_id, period_start, created_by)
      values (s.workspace, s.supplier_id, run_on, run_on + s.due_days, s.currency, coalesce(s.description, s.name),
              s.category, s.amount, s.tax_breakdown, 'open', s.id, run_on, s.created_by)
      on conflict do nothing
      returning id into v_id;
      if v_id is not null then
        made := made + 1;
        update public.bill_schedules set last_bill_id = v_id where id = s.id;
        perform private.notify(
          array(select private.admins_of(s.workspace)),
          s.workspace, 'bill_created',
          format('Bill raised · %s', s.name),
          concat_ws(' · ', private.money(s.amount, s.currency) || ' + tax',
                    'due ' || to_char(run_on + s.due_days, 'FMDD Mon YYYY')),
          '/admin/expenses/bills', 'bill', v_id, now(), null
        );
      end if;
      v_id := null;
      run_on := private.next_run_after(s.anchor_date, s.frequency, s.interval_count, run_on);
    end loop;
    update public.bill_schedules set next_run_on = run_on where id = s.id;
  end loop;
  return made;
end;
$$;

revoke execute on function private.run_bill_schedules(text) from public, anon, authenticated;

-- From the Bills page: the caller's workspace.
create or replace function public.run_bill_schedules()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_access('finance') then
    raise exception 'You don''t have access to Expenses.' using errcode = '42501';
  end if;
  return private.run_bill_schedules(public.current_workspace());
end;
$$;

-- From the hourly job (service role): the live workspace.
create or replace function public.run_bill_schedules_all()
returns integer
language sql
security definer
set search_path = public
as $$
  select private.run_bill_schedules('live');
$$;

revoke execute on function public.run_bill_schedules(), public.run_bill_schedules_all() from public, anon, authenticated;
grant execute on function public.run_bill_schedules() to authenticated, service_role;
grant execute on function public.run_bill_schedules_all() to service_role;

-- pg_cron, if it's there: every morning, like recurring invoices.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'flowstate-bills';
    perform cron.schedule('flowstate-bills', '35 2 * * *', 'select private.run_bill_schedules(''live'')');
  end if;
end;
$$;

-- ─────────────────────────────── reports ───────────────────────────────────
-- 0031's cash-flow inputs, plus payables: open bills by due date, and the
-- schedule runs to come, in rupees.
create or replace function public.report_cashflow_inputs(p_weeks integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ws      text := public.current_workspace();
  today   date := public.local_today();
  horizon date := public.local_today() + least(greatest(coalesce(p_weeks, 12), 1), 52) * 7 - 1;
  w       public.workspaces;
  s       public.invoice_schedules;
  bs      public.bill_schedules;
  run_on  date;
  n       integer;
  runs    jsonb := '[]'::jsonb;
  outs    jsonb := '[]'::jsonb;
begin
  if not public.can_access('reports') then
    raise exception 'You don''t have access to Reports.' using errcode = '42501';
  end if;
  select * into w from public.workspaces where id = ws;

  for s in
    select * from public.invoice_schedules
    where workspace = ws and active and currency = 'LKR' and next_run_on <= horizon
  loop
    run_on := s.next_run_on;
    n := s.occurrences;
    while run_on <= horizon
      and (s.ends_on is null or run_on <= s.ends_on)
      and (s.max_occurrences is null or n < s.max_occurrences)
    loop
      if not exists (select 1 from public.invoices i where i.schedule_id = s.id and i.period_start = run_on) then
        runs := runs || jsonb_build_object('schedule_id', s.id, 'name', s.name, 'run_on', run_on, 'amount', s.amount);
        n := n + 1;
      end if;
      run_on := private.next_run_after(s.anchor_date, s.frequency, s.interval_count, run_on);
    end loop;
  end loop;

  for bs in
    select * from public.bill_schedules
    where workspace = ws and active and currency = 'LKR' and next_run_on <= horizon
  loop
    run_on := bs.next_run_on;
    while run_on <= horizon and (bs.ends_on is null or run_on <= bs.ends_on) loop
      if not exists (select 1 from public.bills b where b.schedule_id = bs.id and b.period_start = run_on) then
        outs := outs || jsonb_build_object(
          'schedule_id', bs.id, 'name', bs.name, 'due_on', run_on + bs.due_days,
          'amount', bs.amount + coalesce((select sum((x ->> 'amount')::numeric) from jsonb_array_elements(bs.tax_breakdown) t(x)), 0));
      end if;
      run_on := private.next_run_after(bs.anchor_date, bs.frequency, bs.interval_count, run_on);
    end loop;
  end loop;

  return jsonb_build_object(
    'as_of',              today,
    'opening_balance',    coalesce(w.opening_balance, 0),
    'opening_balance_on', w.opening_balance_on,
    'receivables',        coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'number', i.number,
               'client', coalesce(c.name, nullif(btrim(i.bill_to_company), ''), nullif(btrim(i.bill_to_name), '')),
               'due_date', i.due_date,
               'balance', private.base_amount(i.balance_due, i.currency, i.exchange_rate),
               'currency', i.currency
             ) order by i.due_date nulls first, i.number)
      from public.invoices i
      left join public.clients c on c.id = i.client_id and c.workspace = i.workspace
      where i.workspace = ws
        and i.kind = 'invoice'
        and i.status in ('issued', 'partially_paid')
        and (i.currency = 'LKR' or i.exchange_rate is not null)
        and i.balance_due > 0
    ), '[]'::jsonb),
    'payables',           coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'reference', b.reference, 'supplier', sup.name,
               'due_date', coalesce(b.due_date, b.bill_date),
               'balance', private.base_amount(b.balance_due, b.currency, b.exchange_rate)
             ) order by coalesce(b.due_date, b.bill_date), sup.name)
      from public.bills b
      join public.suppliers sup on sup.id = b.supplier_id
      where b.workspace = ws
        and b.status in ('open', 'partially_paid')
        and (b.currency = 'LKR' or b.exchange_rate is not null)
        and b.balance_due > 0
    ), '[]'::jsonb),
    'recurring',          coalesce((
      select jsonb_agg(r.e order by r.e ->> 'run_on', r.e ->> 'name') from jsonb_array_elements(runs) as r(e)
    ), '[]'::jsonb),
    'recurring_bills',    coalesce((
      select jsonb_agg(r.e order by r.e ->> 'due_on', r.e ->> 'name') from jsonb_array_elements(outs) as r(e)
    ), '[]'::jsonb),
    'expense_monthly_avg', (
      select round(coalesce(sum(f.amount), 0) / 3, 2)
      from public.finance_entries f
      where f.workspace = ws
        and f.kind = 'expense'
        and f.approval_status = 'approved'
        and f.bill_payment_id is null
        and f.entry_date >= (date_trunc('month', today::timestamp) - interval '3 months')::date
        and f.entry_date < date_trunc('month', today::timestamp)::date
    ),
    'budgets_monthly_total', (
      select round(coalesce(sum(case b.period when 'quarterly' then b.amount / 3
                                              when 'yearly' then b.amount / 12
                                              else b.amount end), 0), 2)
      from public.budgets b
      where b.workspace = ws and b.active
    )
  );
end;
$$;

revoke execute on function public.report_cashflow_inputs(integer) from public, anon, authenticated;
grant execute on function public.report_cashflow_inputs(integer) to authenticated, service_role;

-- 0033's tax report, with input tax from bills (by bill date, in rupees; void
-- and draft bills don't count).
create or replace function public.report_tax(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ws   text := public.current_workspace();
  base jsonb;
begin
  if not public.can_access('reports') then
    raise exception 'You don''t have access to Reports.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Pick a period that ends on or after the day it starts.' using errcode = '22023';
  end if;

  base := (
    with docs as (
      select i.id, i.number, i.kind, i.issue_date, i.currency, i.exchange_rate, i.tax_breakdown,
             case when i.kind = 'credit_note' then -1 else 1 end as sign,
             coalesce(c.name, nullif(btrim(i.bill_to_company), ''), nullif(btrim(i.bill_to_name), '')) as client,
             i.bill_to_tax_id,
             private.base_amount(i.total, i.currency, i.exchange_rate) as total_lkr,
             private.base_amount(i.tax_total, i.currency, i.exchange_rate) as tax_lkr,
             private.base_amount(i.total - i.tax_total, i.currency, i.exchange_rate) as net_lkr
      from public.invoices i
      left join public.clients c on c.id = i.client_id and c.workspace = i.workspace
      where i.workspace = ws
        and ((i.kind = 'invoice' and i.status in ('issued', 'partially_paid', 'paid', 'credited', 'written_off'))
             or (i.kind = 'credit_note' and i.status = 'issued'))
        and i.issue_date between p_from and p_to
    ),
    lines as (
      select (b.x ->> 'name') as name, (b.x ->> 'rate')::numeric as rate,
             coalesce((b.x ->> 'compound')::boolean, false) as compound,
             d.sign * private.base_amount((b.x ->> 'base')::numeric, d.currency, d.exchange_rate) as base_lkr,
             d.sign * private.base_amount((b.x ->> 'amount')::numeric, d.currency, d.exchange_rate) as amount_lkr
      from docs d, jsonb_array_elements(d.tax_breakdown) as b(x)
      where d.total_lkr is not null
    )
    select jsonb_build_object(
      'from', p_from,
      'to', p_to,
      'currency', 'LKR',
      'output', coalesce((
        select jsonb_agg(jsonb_build_object('name', l.name, 'rate', l.rate, 'compound', l.compound,
                                            'base', l.base, 'amount', l.amount, 'documents', l.n)
                         order by l.compound, l.name, l.rate)
        from (select name, rate, compound, sum(base_lkr) as base, sum(amount_lkr) as amount, count(*) as n
              from lines group by name, rate, compound) l
      ), '[]'::jsonb),
      'output_total', coalesce((select sum(amount_lkr) from lines), 0),
      'sales_net', coalesce((select sum(sign * net_lkr) from docs where total_lkr is not null), 0),
      'sales_total', coalesce((select sum(sign * total_lkr) from docs where total_lkr is not null), 0),
      'untaxed_total', coalesce((select sum(sign * total_lkr) from docs
                                 where total_lkr is not null and jsonb_array_length(tax_breakdown) = 0), 0),
      'unconverted', coalesce((
        select jsonb_agg(jsonb_build_object('id', d.id, 'number', d.number, 'currency', d.currency))
        from docs d where d.total_lkr is null
      ), '[]'::jsonb),
      'documents', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', d.id, 'number', d.number, 'kind', d.kind, 'issue_date', d.issue_date,
                 'client', d.client, 'tax_id', d.bill_to_tax_id, 'currency', d.currency,
                 'net', d.sign * d.net_lkr, 'tax', d.sign * d.tax_lkr, 'total', d.sign * d.total_lkr)
               order by d.issue_date, d.number)
        from (select * from docs where total_lkr is not null order by issue_date, number limit 1000) d
      ), '[]'::jsonb)
    )
  );

  return base || (
    with bl as (
      select b.id, b.currency, b.exchange_rate, b.subtotal, b.tax_breakdown
      from public.bills b
      where b.workspace = ws and b.status in ('open', 'partially_paid', 'paid')
        and b.bill_date between p_from and p_to
    ),
    taxes as (
      select (x ->> 'name') as name, (x ->> 'rate')::numeric as rate,
             private.base_amount(bl.subtotal, bl.currency, bl.exchange_rate) as base_lkr,
             private.base_amount((x ->> 'amount')::numeric, bl.currency, bl.exchange_rate) as amount_lkr
      from bl, jsonb_array_elements(bl.tax_breakdown) as t(x)
      where bl.currency = 'LKR' or bl.exchange_rate is not null
    )
    select jsonb_build_object(
      'input', coalesce((
        select jsonb_agg(jsonb_build_object('name', g.name, 'rate', g.rate, 'base', g.base, 'amount', g.amount, 'documents', g.n)
                         order by g.name, g.rate)
        from (select name, rate, sum(base_lkr) as base, sum(amount_lkr) as amount, count(*) as n
              from taxes group by name, rate) g
      ), '[]'::jsonb),
      'input_total', coalesce((select sum(amount_lkr) from taxes), 0)
    )
  );
end;
$$;

revoke execute on function public.report_tax(date, date) from public, anon, authenticated;
grant execute on function public.report_tax(date, date) to authenticated, service_role;

-- ───────────────────────────── desktop sync ────────────────────────────────
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'powersync') then
    return;
  end if;
  foreach t in array array['suppliers', 'bills', 'bill_payments', 'bill_schedules'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'powersync' and schemaname = 'public' and tablename = t) then
      execute format('alter publication powersync add table public.%I', t);
    end if;
  end loop;
end;
$$;
