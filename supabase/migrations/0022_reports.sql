-- ============================================================================
-- 0022 · Reports
-- The three numbers pages behind the Reports module:
--   report_pnl(from, to)               — profit & loss for a period, by category
--                                         and month, against the period before
--   report_receivables_aging(currency) — what clients still owe, by how late
--   report_cashflow_inputs(weeks)      — what the cash-flow forecast is built
--                                         from (the forecast maths itself is a
--                                         pure function in lib/admin/reports.ts)
--
-- Reports are aggregates, so they're security definer: a member with only the
-- Reports module sees the totals without being able to read a single ledger
-- row or invoice. In exchange each one checks can_access('reports') itself
-- and only ever reads the caller's own workspace — the demo account gets the
-- demo's numbers, never the live ones.
--
-- Only approved ledger entries count (0016), like every other total. Money is
-- as stored: the ledger is kept in LKR (invoice payments post amount_base),
-- aging is per invoice currency, and the forecast is LKR only.
--
-- The forecast starts from an opening balance — cash in the bank on a given
-- day — kept on the workspace row, which admins update directly (0008's
-- "workspaces: admins update own").
-- Requires: 0021
-- ============================================================================

-- ───────────────────────────── opening balance ─────────────────────────────
alter table public.workspaces add column if not exists opening_balance numeric(14, 2) not null default 0;
alter table public.workspaces add column if not exists opening_balance_on date;

comment on column public.workspaces.opening_balance is
  'Cash in the bank (LKR) on opening_balance_on — where the cash-flow forecast''s running balance starts.';

-- ──────────────────────────────── P&L ──────────────────────────────────────
-- Income and expenses between two days (inclusive), by category and by month
-- (every month of the period, zero-filled), with the same totals for the
-- period before: whole calendar months compare with as many months before (a
-- quarter with the previous quarter), any other range with as many days.
create or replace function public.report_pnl(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ws        text := public.current_workspace();
  months    integer;
  prev_from date;
  prev_to   date;
  cur       record;
  prev      record;
begin
  if not public.can_access('reports') then
    raise exception 'You don''t have access to Reports.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Pick a period that ends on or after the day it starts.' using errcode = '22023';
  end if;
  if p_to - p_from > 36600 then
    raise exception 'Pick a period of 100 years or less.' using errcode = '22023';
  end if;

  if p_from = date_trunc('month', p_from::timestamp)::date
     and p_to + 1 = date_trunc('month', (p_to + 1)::timestamp)::date then
    months := ((extract(year from p_to) - extract(year from p_from)) * 12
               + extract(month from p_to) - extract(month from p_from))::integer + 1;
    prev_from := (p_from - make_interval(months => months))::date;
  else
    prev_from := p_from - (p_to - p_from + 1);
  end if;
  prev_to := p_from - 1;

  select coalesce(sum(f.amount) filter (where f.kind = 'income'), 0)::numeric(14, 2)  as income,
         coalesce(sum(f.amount) filter (where f.kind = 'expense'), 0)::numeric(14, 2) as expense
  into cur
  from public.finance_entries f
  where f.workspace = ws and f.approval_status = 'approved' and f.entry_date between p_from and p_to;

  select coalesce(sum(f.amount) filter (where f.kind = 'income'), 0)::numeric(14, 2)  as income,
         coalesce(sum(f.amount) filter (where f.kind = 'expense'), 0)::numeric(14, 2) as expense
  into prev
  from public.finance_entries f
  where f.workspace = ws and f.approval_status = 'approved' and f.entry_date between prev_from and prev_to;

  return jsonb_build_object(
    'from',          p_from,
    'to',            p_to,
    'income_total',  cur.income,
    'expense_total', cur.expense,
    'net',           cur.income - cur.expense,
    'margin',        case when cur.income > 0 then round((cur.income - cur.expense) * 100 / cur.income, 1) end,
    'by_category',   coalesce((
      select jsonb_agg(jsonb_build_object('kind', c.kind, 'category', c.category, 'amount', c.amount)
                       order by c.kind <> 'income', c.amount desc, c.category)
      from (
        select f.kind::text as kind, btrim(f.category) as category, sum(f.amount)::numeric(14, 2) as amount
        from public.finance_entries f
        where f.workspace = ws and f.approval_status = 'approved' and f.entry_date between p_from and p_to
        group by 1, 2
      ) c
    ), '[]'::jsonb),
    'monthly',       (
      select jsonb_agg(jsonb_build_object(
               'month',   to_char(m.month, 'YYYY-MM-DD'),
               'income',  coalesce(s.income, 0),
               'expense', coalesce(s.expense, 0),
               'net',     coalesce(s.income, 0) - coalesce(s.expense, 0)
             ) order by m.month)
      from generate_series(date_trunc('month', p_from::timestamp), date_trunc('month', p_to::timestamp), interval '1 month') as m(month)
      left join (
        select date_trunc('month', f.entry_date::timestamp) as month,
               sum(f.amount) filter (where f.kind = 'income')::numeric(14, 2)  as income,
               sum(f.amount) filter (where f.kind = 'expense')::numeric(14, 2) as expense
        from public.finance_entries f
        where f.workspace = ws and f.approval_status = 'approved' and f.entry_date between p_from and p_to
        group by 1
      ) s on s.month = m.month
    ),
    'previous',      jsonb_build_object(
      'from',          prev_from,
      'to',            prev_to,
      'income_total',  prev.income,
      'expense_total', prev.expense,
      'net',           prev.income - prev.expense
    )
  );
end;
$$;

-- ──────────────────────────── receivables aging ────────────────────────────
-- Balance left on issued and part-paid invoices in one currency, bucketed by
-- days past due as of today in Colombo: current (not yet due, due today, or no
-- due date), 1–30, 31–60, 61–90, 90+. days_overdue is negative while an
-- invoice is still ahead of its due date. Grouped by client; invoices without
-- one are grouped by who they're billed to.
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
begin
  if not public.can_access('reports') then
    raise exception 'You don''t have access to Reports.' using errcode = '42501';
  end if;
  if cur !~ '^[A-Z]{3}$' then
    raise exception 'Pick a currency code such as LKR.' using errcode = '22023';
  end if;

  return (
    with aged as (
      select i.id, i.number, i.due_date, i.balance_due as balance, i.client_id,
             coalesce(today - i.due_date, 0) as days_overdue,
             coalesce(c.name, nullif(btrim(i.bill_to_company), ''), nullif(btrim(i.bill_to_name), ''), 'No client') as name
      from public.invoices i
      left join public.clients c on c.id = i.client_id and c.workspace = i.workspace
      where i.workspace = ws
        and i.kind = 'invoice'
        and i.status in ('issued', 'partially_paid')
        and i.currency = cur
        and i.balance_due > 0
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
               'balance', a.balance, 'days_overdue', a.days_overdue
             ) order by a.days_overdue desc, a.due_date, a.number) as invoices
      from aged a
      group by a.client_id, case when a.client_id is null then a.name end
    )
    select jsonb_build_object(
      'as_of',    today,
      'currency', cur,
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

-- ─────────────────────────── cash-flow inputs ──────────────────────────────
-- Everything in LKR, as of today in Colombo:
--   · receivables — every open invoice with a balance, overdue ones included
--     (the page shows those as "at risk"), with its due date;
--   · recurring — each active schedule's runs from its next one to the end of
--     the horizon (p_weeks from today, 1–52), stepped from its anchor the way
--     run_recurring_invoices() makes them (0015), within ends_on and
--     max_occurrences; runs already due but not generated yet count too;
--   · expense_monthly_avg — approved expenses over the last three full months ÷ 3;
--   · budgets_monthly_total — active budgets as a monthly figure.
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
               'due_date', i.due_date, 'balance', i.balance_due
             ) order by i.due_date nulls first, i.number)
      from public.invoices i
      left join public.clients c on c.id = i.client_id and c.workspace = i.workspace
      where i.workspace = ws
        and i.kind = 'invoice'
        and i.status in ('issued', 'partially_paid')
        and i.currency = 'LKR'
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

revoke execute on function public.report_pnl(date, date), public.report_receivables_aging(text),
  public.report_cashflow_inputs(integer)
  from public, anon, authenticated;
grant execute on function public.report_pnl(date, date), public.report_receivables_aging(text),
  public.report_cashflow_inputs(integer)
  to authenticated, service_role;
