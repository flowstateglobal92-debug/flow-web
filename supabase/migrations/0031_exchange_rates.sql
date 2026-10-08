-- ============================================================================
-- 0031 · Exchange rates
-- A foreign-currency document keeps the rate it was billed at, in rupees per
-- one unit of its currency (for a Sri Lankan tax invoice: the Central Bank's
-- selling rate on the invoice date). Rupee documents never carry one. With it:
--   · a payment's "received in LKR" fills itself in when it's left out
--     (rate × amount) — what actually arrived can still be typed in;
--   · the Invoices headline numbers, aging ("ALL" currencies) and the
--     cash-flow forecast count foreign invoices in rupees; documents without
--     a rate are listed apart, as before;
--   · the approval line (0016) is judged on the rupee value.
-- private.base_amount() is the one conversion rule; the browser's copy is
-- baseAmount() in src/lib/admin/invoice-types.ts.
-- Requires: 0030. Idempotent.
-- ============================================================================

alter table public.invoices add column if not exists exchange_rate numeric(18, 6);

comment on column public.invoices.exchange_rate is
  'LKR per one unit of the document''s currency, as billed. Null for LKR documents (and foreign ones without a rate).';

alter table public.invoices drop constraint if exists invoices_exchange_rate_check;
alter table public.invoices
  add constraint invoices_exchange_rate_check check (exchange_rate is null or exchange_rate > 0);

-- Rupee documents don't carry a rate. Sorts before invoices_guard and
-- invoices_totals, like every BEFORE trigger here (they run by name).
create or replace function private.invoice_currency_rate()
returns trigger
language plpgsql
as $$
begin
  if new.currency = 'LKR' then
    new.exchange_rate := null;
  end if;
  return new;
end;
$$;

revoke execute on function private.invoice_currency_rate() from public, anon, authenticated;

drop trigger if exists invoices_currency_rate on public.invoices;
create trigger invoices_currency_rate
  before insert or update on public.invoices
  for each row execute function private.invoice_currency_rate();

-- An amount in rupees: as is for LKR, × the document's rate otherwise, null
-- when a foreign document has no rate.
create or replace function private.base_amount(p_amount numeric, p_currency text, p_rate numeric)
returns numeric
language sql
immutable
as $$
  select case
    when upper(coalesce(p_currency, 'LKR')) = 'LKR' then p_amount
    when p_rate is null then null
    else round(p_amount * p_rate, 2)
  end;
$$;

revoke execute on function private.base_amount(numeric, text, numeric) from public, anon, authenticated;

-- ───────────────────────────── save_invoice ────────────────────────────────
-- 0029's function; exchange_rate is editable.
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
    'payment_details', 'exchange_rate'
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

  execute format(
    'update public.invoices i set %s from jsonb_populate_record(null::public.invoices, $1) r where i.id = $2',
    concat_ws(', ', v_set, 'updated_at = now()')
  ) using p_invoice, v_id;

  return v_id;
end;
$$;

revoke execute on function public.save_invoice(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_invoice(jsonb, jsonb) to authenticated, service_role;

-- ───────────────────────────── payments ────────────────────────────────────
-- 0013's check: a foreign invoice's payment with no rupee amount takes it
-- from the document's rate instead of being refused.
create or replace function private.check_invoice_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv   public.invoices;
  other numeric(14, 2);
  left_ numeric(14, 2);
begin
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
    raise exception 'A payment can''t move to another invoice — remove it and record it again.'
      using errcode = 'check_violation';
  end if;

  select * into inv from public.invoices where id = new.invoice_id for update;
  if not found then
    raise exception 'That invoice doesn''t exist.' using errcode = 'foreign_key_violation';
  end if;
  new.workspace := inv.workspace;

  if inv.kind <> 'invoice' or inv.status not in ('issued', 'partially_paid', 'paid') then
    raise exception 'Payments can only be recorded on an issued invoice.' using errcode = 'check_violation';
  end if;

  if inv.currency = 'LKR' then
    new.amount_base := new.amount;
  elsif (new.amount_base is null or new.amount_base <= 0) and inv.exchange_rate is not null then
    new.amount_base := round(new.amount * inv.exchange_rate, 2);
  elsif new.amount_base is null or new.amount_base <= 0 then
    raise exception 'Enter what arrived in rupees — Income is kept in LKR.' using errcode = 'check_violation';
  end if;

  select coalesce(sum(p.amount), 0) into other
  from public.invoice_payments p
  where p.invoice_id = inv.id and p.id <> new.id;
  left_ := inv.total - other;

  if new.amount > left_ then
    if left_ <= 0 then
      raise exception '% is already paid in full.', coalesce(inv.number, 'This invoice')
        using errcode = 'check_violation';
    end if;
    raise exception 'That''s more than the % left to pay.', private.money(left_, inv.currency)
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_invoice_payment() from public, anon, authenticated;

-- ───────────────────────────── approval line ───────────────────────────────
-- 0016's two checks, on the rupee value (a foreign invoice without a rate is
-- judged on its face value, as before).
create or replace function private.guard_issued_invoice_total()
returns trigger
language plpgsql
security invoker
as $$
declare
  line numeric(14, 2);
begin
  if current_user not in ('authenticated', 'anon')
     or new.kind <> 'invoice'
     or new.status not in ('issued', 'partially_paid', 'paid')
     or new.total <= old.total
     or public.is_admin() then
    return null;
  end if;
  select w.invoice_approval_threshold into line from public.workspaces w where w.id = new.workspace;
  line := coalesce(line, 500000);
  -- The rupee value (private.base_amount, spelled out: this runs as the API caller).
  if (case when new.currency <> 'LKR' and new.exchange_rate is not null
           then round(new.total * new.exchange_rate, 2) else new.total end) >= line then
    raise exception 'Issued invoices of Rs % or more need an admin — ask one to make this change.',
      to_char(line, 'FM999,999,999,990')
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

revoke execute on function private.guard_issued_invoice_total() from public, anon, authenticated;

create or replace function public.issue_document(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  doc  public.invoices;
  line numeric(14, 2);
begin
  if not public.can_access('invoices') then
    raise exception 'You don''t have access to Invoices.' using errcode = '42501';
  end if;
  select * into doc from public.invoices
  where id = p_id and workspace = public.current_workspace()
  for update;
  if not found then
    raise exception 'That document isn''t available.' using errcode = 'P0002';
  end if;
  if doc.status = 'pending_approval' then
    raise exception 'This invoice is waiting for approval — an admin approves or rejects it.'
      using errcode = 'check_violation';
  end if;

  if doc.kind = 'invoice' and doc.status = 'draft' and not public.is_admin() then
    select w.invoice_approval_threshold into line from public.workspaces w where w.id = doc.workspace;
    if coalesce(private.base_amount(doc.total, doc.currency, doc.exchange_rate), doc.total) >= coalesce(line, 500000) then
      if btrim(doc.bill_to_name) = '' then
        raise exception 'Add who this is billed to before issuing it.' using errcode = 'check_violation';
      end if;
      if not exists (select 1 from public.invoice_items where invoice_id = p_id) then
        raise exception 'Add at least one line item before issuing it.' using errcode = 'check_violation';
      end if;
      update public.invoices set status = 'pending_approval' where id = p_id;
      return jsonb_build_object('status', 'pending_approval', 'number', null);
    end if;
  end if;

  return private.issue_invoice(p_id);
end;
$$;

revoke execute on function public.issue_document(uuid) from public, anon, authenticated;
grant execute on function public.issue_document(uuid) to authenticated, service_role;

-- ───────────────────────────── headline numbers ────────────────────────────
-- 0013's invoice_kpis, in rupees: a foreign invoice counts at its rate. Ones
-- without a rate stay out of the totals and are named in other_currencies.
create or replace function public.invoice_kpis(p_from date default null, p_to date default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as (
    select coalesce(
      (select s.default_currency from public.invoice_settings s where s.workspace = public.current_workspace()),
      'LKR'
    ) as currency
  ),
  docs as (
    select i.currency,
           -- private.base_amount, spelled out: this runs as the caller, who can't reach private.*
           case when i.currency = cfg.currency then i.total
                when i.exchange_rate is not null then round(i.total * i.exchange_rate, 2) end as total,
           case when i.currency = cfg.currency then i.balance_due
                when i.exchange_rate is not null then round(i.balance_due * i.exchange_rate, 2) end as balance_due,
           i.due_date,
           (p_from is null or i.issue_date >= p_from) and (p_to is null or i.issue_date <= p_to) as in_period,
           i.status in ('issued', 'partially_paid') as open
    from public.invoices i
    cross join cfg
    where i.workspace = public.current_workspace()
      and i.kind = 'invoice'
      and i.status in ('issued', 'partially_paid', 'paid')
  )
  select jsonb_build_object(
    'issued_total',      coalesce(sum(d.total) filter (where d.in_period and d.total is not null), 0),
    'issued_count',      count(*) filter (where d.in_period and d.total is not null),
    'received_total',    (select coalesce(sum(p.amount_base), 0)
                          from public.invoice_payments p
                          where p.workspace = public.current_workspace()
                            and (p_from is null or p.paid_on >= p_from)
                            and (p_to is null or p.paid_on <= p_to)),
    'outstanding_total', coalesce(sum(d.balance_due) filter (where d.open and d.balance_due is not null), 0),
    'outstanding_count', count(*) filter (where d.open and d.balance_due is not null),
    'overdue_total',     coalesce(sum(d.balance_due) filter (
                           where d.open and d.balance_due is not null and d.due_date < public.local_today()), 0),
    'overdue_count',     count(*) filter (
                           where d.open and d.balance_due is not null and d.due_date < public.local_today()),
    'currency',          cfg.currency,
    'other_currencies',  coalesce(
                           array_agg(distinct d.currency) filter (
                             where d.total is null and (d.in_period or d.open)),
                           '{}'::text[])
  )
  from cfg
  left join docs d on true
  group by cfg.currency;
$$;

revoke execute on function public.invoice_kpis(date, date) from public, anon, authenticated;
grant execute on function public.invoice_kpis(date, date) to authenticated, service_role;

-- ──────────────────────────── receivables aging ────────────────────────────
-- 0022's report. p_currency 'ALL' puts every open invoice in rupees (at its
-- rate); those without a rate are counted under "unconverted".
create or replace function public.report_receivables_aging(p_currency text default 'LKR')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ws    text := public.current_workspace();
  today date := public.local_today();
  cur   text := upper(btrim(coalesce(p_currency, 'LKR')));
  every boolean := upper(btrim(coalesce(p_currency, ''))) = 'ALL';
begin
  if not public.can_access('reports') then
    raise exception 'You don''t have access to Reports.' using errcode = '42501';
  end if;
  if not every and cur !~ '^[A-Z]{3}$' then
    raise exception 'Pick a currency code such as LKR.' using errcode = '22023';
  end if;

  return (
    with open_docs as (
      select i.id, i.number, i.due_date, i.client_id, i.currency, i.workspace, i.bill_to_company, i.bill_to_name,
             case when every then private.base_amount(i.balance_due, i.currency, i.exchange_rate)
                  else i.balance_due end as balance
      from public.invoices i
      where i.workspace = ws
        and i.kind = 'invoice'
        and i.status in ('issued', 'partially_paid')
        and (every or i.currency = cur)
        and i.balance_due > 0
    ),
    aged as (
      select o.id, o.number, o.due_date, o.balance, o.client_id, o.currency,
             coalesce(today - o.due_date, 0) as days_overdue,
             coalesce(c.name, nullif(btrim(o.bill_to_company), ''), nullif(btrim(o.bill_to_name), ''), 'No client') as name
      from open_docs o
      left join public.clients c on c.id = o.client_id and c.workspace = o.workspace
      where o.balance is not null
    ),
    by_client as (
      select a.client_id,
             min(a.name) as name,
             coalesce(sum(a.balance) filter (where a.days_overdue <= 0), 0)                     as current,
             coalesce(sum(a.balance) filter (where a.days_overdue between 1 and 30), 0)        as d1_30,
             coalesce(sum(a.balance) filter (where a.days_overdue between 31 and 60), 0)       as d31_60,
             coalesce(sum(a.balance) filter (where a.days_overdue between 61 and 90), 0)       as d61_90,
             coalesce(sum(a.balance) filter (where a.days_overdue > 90), 0)                    as d90_plus,
             sum(a.balance)                                                                     as total,
             jsonb_agg(jsonb_build_object(
               'id', a.id, 'number', a.number, 'due_date', a.due_date,
               'balance', a.balance, 'days_overdue', a.days_overdue, 'currency', a.currency
             ) order by a.days_overdue desc, a.due_date, a.number) as invoices
      from aged a
      group by a.client_id, case when a.client_id is null then a.name end
    )
    select jsonb_build_object(
      'as_of',       today,
      'currency',    case when every then 'LKR' else cur end,
      'converted',   every,
      'unconverted', (
        select coalesce(jsonb_agg(jsonb_build_object('currency', u.currency, 'count', u.n)), '[]'::jsonb)
        from (select o.currency, count(*) as n from open_docs o where o.balance is null group by o.currency) u
      ),
      'totals',   (
        select jsonb_build_object(
          'current',  coalesce(sum(b.current), 0),
          'd1_30',    coalesce(sum(b.d1_30), 0),
          'd31_60',   coalesce(sum(b.d31_60), 0),
          'd61_90',   coalesce(sum(b.d61_90), 0),
          'd90_plus', coalesce(sum(b.d90_plus), 0),
          'total',    coalesce(sum(b.total), 0)
        )
        from by_client b
      ),
      'clients',  coalesce((
        select jsonb_agg(jsonb_build_object(
                 'client_id', b.client_id, 'name', b.name,
                 'current', b.current, 'd1_30', b.d1_30, 'd31_60', b.d31_60, 'd61_90', b.d61_90,
                 'd90_plus', b.d90_plus, 'total', b.total, 'invoices', b.invoices
               ) order by b.total desc, b.name)
        from by_client b
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke execute on function public.report_receivables_aging(text) from public, anon, authenticated;
grant execute on function public.report_receivables_aging(text) to authenticated, service_role;

-- ─────────────────────────── cash-flow inputs ──────────────────────────────
-- 0022's report; foreign invoices with a rate are expected in rupees too.
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
  run_on  date;
  n       integer;
  runs    jsonb := '[]'::jsonb;
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
    'recurring',          coalesce((
      select jsonb_agg(r.e order by r.e ->> 'run_on', r.e ->> 'name') from jsonb_array_elements(runs) as r(e)
    ), '[]'::jsonb),
    'expense_monthly_avg', (
      select round(coalesce(sum(f.amount), 0) / 3, 2)
      from public.finance_entries f
      where f.workspace = ws
        and f.kind = 'expense'
        and f.approval_status = 'approved'
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
