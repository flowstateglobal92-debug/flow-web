-- ============================================================================
-- 0037 · Client statements
-- A statement of account per client and currency for any period: the balance
-- brought forward, every invoice, credit note, payment and refund in the
-- period with a running balance, the balance carried forward, and what's
-- still open (with how late it is).
--
--   client_statement(client, from, to, currency) — the figures. Invoker: it
--     reads as the caller, so it needs Invoices like the invoices themselves.
--     Voided documents never happened; drafts haven't yet.
--   clients.statement_monthly — send this client a statement on the 1st of
--     each month (for the month before) while they owe something. The
--     scheduled job (0038) does the sending; statements_due() lists who's
--     due — for the service role only.
-- Requires: 0036. Idempotent.
-- ============================================================================

alter table public.clients add column if not exists statement_monthly boolean not null default false;

comment on column public.clients.statement_monthly is
  'Email this client a statement on the 1st of each month while they owe something (0037).';

create or replace function public.client_statement(
  p_client uuid, p_from date, p_to date, p_currency text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  c        public.clients;
  cur      text;
  opening  numeric(14, 2);
  result   jsonb;
begin
  if not public.can_access('invoices') then
    raise exception 'You don''t have access to Invoices.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Pick a period that ends on or after the day it starts.' using errcode = '22023';
  end if;
  select * into c from public.clients where id = p_client;
  if not found then
    raise exception 'That client isn''t available.' using errcode = 'P0002';
  end if;

  -- The currency asked for, else the one most of their documents are in.
  cur := upper(nullif(btrim(coalesce(p_currency, '')), ''));
  if cur is null then
    select i.currency into cur
    from public.invoices i
    where i.client_id = p_client and i.kind = 'invoice' and i.status not in ('draft', 'void', 'pending_approval')
    group by i.currency
    order by count(*) desc, i.currency
    limit 1;
    cur := coalesce(cur, 'LKR');
  end if;

  with docs as (
    select i.id, i.kind, i.number, i.issue_date, i.due_date, i.total, i.balance_due, i.status
    from public.invoices i
    where i.client_id = p_client and i.currency = cur
      and ((i.kind = 'invoice' and i.status in ('issued', 'partially_paid', 'paid', 'credited', 'written_off'))
           or (i.kind = 'credit_note' and i.status = 'issued'))
  ),
  moves as (
    -- + what they owe more, − what settles it
    select d.issue_date as day, 1 as ord, 'invoice' as type, d.id as doc_id, d.number as ref,
           coalesce(nullif(btrim(i.subject), ''), 'Invoice') as detail, d.total as amount
    from docs d join public.invoices i on i.id = d.id
    where d.kind = 'invoice'
    union all
    select d.issue_date, 2, 'credit_note', d.id, d.number,
           'Credit note' || coalesce(' for ' || p.number, ''), -d.total
    from docs d join public.invoices cn on cn.id = d.id
    left join public.invoices p on p.id = cn.credited_invoice_id
    where d.kind = 'credit_note'
    union all
    select pay.paid_on, case when pay.kind = 'refund' then 4 else 3 end,
           case when pay.kind = 'refund' then 'refund' else 'payment' end, d.id, d.number,
           concat_ws(' · ', case when pay.kind = 'refund' then 'Refund' else 'Payment' end, nullif(btrim(pay.method), ''),
                     nullif(btrim(pay.reference), '')),
           case when pay.kind = 'refund' then pay.amount else -pay.amount end
    from public.invoice_payments pay join docs d on d.id = pay.invoice_id
  )
  select
    coalesce(sum(m.amount) filter (where m.day < p_from), 0),
    jsonb_build_object(
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'date', x.day, 'type', x.type, 'doc_id', x.doc_id, 'ref', x.ref, 'detail', x.detail,
                 'debit', case when x.amount > 0 then x.amount else 0 end,
                 'credit', case when x.amount < 0 then -x.amount else 0 end,
                 'balance', x.running)
               order by x.day, x.ord, x.ref)
        from (
          select mm.*,
                 sum(mm.amount) over (order by mm.day, mm.ord, mm.ref rows between unbounded preceding and current row) as running
          from moves mm
          where mm.day between p_from and p_to
        ) x
      ), '[]'::jsonb),
      'period_debit', coalesce(sum(m.amount) filter (where m.day between p_from and p_to and m.amount > 0), 0),
      'period_credit', coalesce(-sum(m.amount) filter (where m.day between p_from and p_to and m.amount < 0), 0)
    )
  into opening, result
  from moves m;

  -- The running balance above starts at zero: carry the opening balance in.
  result := jsonb_set(result, '{lines}', coalesce((
    select jsonb_agg(l || jsonb_build_object('balance', (l ->> 'balance')::numeric + opening) order by n)
    from jsonb_array_elements(result -> 'lines') with ordinality as e(l, n)
  ), '[]'::jsonb));

  return result || jsonb_build_object(
    'client', jsonb_build_object('id', c.id, 'name', c.name, 'company', c.company, 'email', c.email,
                                 'address', concat_ws(E'\n', nullif(btrim(c.address), ''), nullif(btrim(c.city), ''), nullif(btrim(c.country), '')),
                                 'tax_id', c.tax_id),
    'currency', cur,
    'from', p_from,
    'to', p_to,
    'opening', opening,
    'closing', opening + (result ->> 'period_debit')::numeric - (result ->> 'period_credit')::numeric,
    'currencies', coalesce((
      select jsonb_agg(distinct i.currency)
      from public.invoices i
      where i.client_id = p_client and i.status not in ('draft', 'void', 'pending_approval')
    ), '[]'::jsonb),
    'open', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'number', i.number, 'issue_date', i.issue_date, 'due_date', i.due_date,
               'total', i.total, 'balance', i.balance_due,
               'days_overdue', greatest(0, p_to - coalesce(i.due_date, p_to)))
             order by i.due_date nulls last, i.number)
      from public.invoices i
      where i.client_id = p_client and i.currency = cur and i.kind = 'invoice'
        and i.status in ('issued', 'partially_paid') and i.balance_due > 0 and i.issue_date <= p_to
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.client_statement(uuid, date, date, text) from public, anon, authenticated;
grant execute on function public.client_statement(uuid, date, date, text) to authenticated, service_role;

-- Clients due their monthly statement on p_day (the 1st): wanting one, owing
-- something, with an email address, and not sent one yet this month. Called
-- by the scheduled job (0038) with the service role — no one else can run it.
create or replace function public.statements_due(p_day date default public.local_today())
returns table (client_id uuid, workspace text, email text, currency text, balance numeric)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.workspace, c.email, i.currency, sum(i.balance_due)
  from public.clients c
  join public.invoices i on i.client_id = c.id and i.kind = 'invoice' and i.status in ('issued', 'partially_paid')
  where c.statement_monthly
    and c.status <> 'archived'
    and c.workspace = 'live'
    and nullif(btrim(c.email), '') is not null
    and extract(day from p_day) = 1
    and not exists (
      select 1 from public.document_emails e
      where e.client_id = c.id and e.kind = 'statement'
        and e.sent_at >= date_trunc('month', p_day::timestamp)
    )
  group by c.id, c.workspace, c.email, i.currency
  having sum(i.balance_due) > 0;
$$;

revoke execute on function public.statements_due(date) from public, anon, authenticated;
grant execute on function public.statements_due(date) to service_role;
