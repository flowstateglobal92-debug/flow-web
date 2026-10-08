-- ============================================================================
-- 0038 · Overdue reminders
-- Polite emails, with the invoice attached, a few days after an invoice falls
-- due — by default at +3, +7 and +14 days — until it's paid. Off until an
-- admin switches it on.
--
--   invoice_settings.reminders_enabled / reminder_days / email_reminder_* —
--     on or off, which days after the due date, and the wording (empty = the
--     built-in wording, lib/admin/document-mail.ts).
--   clients.reminders_paused, invoices.reminders_paused — leave this client,
--     or this one invoice, alone.
--   reminders_due() — the invoices due a reminder today and which one (1, 2,
--     3…), for the scheduled job (/api/jobs/run, service role only). A
--     reminder is "sent" once document_emails has a reminder row with its step,
--     so a run that's repeated never sends twice.
--   client_statement() (0037) now also answers the scheduled job (service
--     role), for the monthly statements.
-- Requires: 0037. Idempotent.
-- ============================================================================

alter table public.invoice_settings add column if not exists reminders_enabled boolean not null default false;
alter table public.invoice_settings add column if not exists reminder_days integer[] not null default '{3,7,14}';
alter table public.invoice_settings add column if not exists email_reminder_subject text;
alter table public.invoice_settings add column if not exists email_reminder_body text;

alter table public.invoice_settings drop constraint if exists invoice_settings_reminders_check;
alter table public.invoice_settings
  add constraint invoice_settings_reminders_check check (
    cardinality(reminder_days) between 1 and 6
    and 1 <= all (reminder_days) and 365 >= all (reminder_days)
    and coalesce(char_length(email_reminder_subject), 0) <= 200
    and coalesce(char_length(email_reminder_body), 0) <= 4000
  );

alter table public.clients add column if not exists reminders_paused boolean not null default false;
alter table public.invoices add column if not exists reminders_paused boolean not null default false;

comment on column public.clients.reminders_paused is 'No automatic payment reminders to this client (0038).';
comment on column public.invoices.reminders_paused is 'No automatic payment reminders for this invoice (0038).';

-- The next reminder each open, overdue invoice is due today. Steps follow
-- reminder_days in order (sorted); a step whose day has passed is sent once,
-- even if earlier ones were missed — a late start never sends three at once.
create or replace function public.reminders_due(p_today date default public.local_today())
returns table (invoice_id uuid, workspace text, step integer, days_overdue integer, email text)
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select s.workspace, array(select d from unnest(s.reminder_days) d order by d) as days
    from public.invoice_settings s
    where s.reminders_enabled and s.workspace = 'live'
  ),
  open_docs as (
    select i.id, i.workspace, i.due_date, (p_today - i.due_date) as late,
           coalesce(nullif(btrim(i.bill_to_email), ''), nullif(btrim(c.email), '')) as email,
           (select count(*) from public.document_emails e
            where e.invoice_id = i.id and e.kind = 'reminder') as sent,
           (select max(e.step) from public.document_emails e
            where e.invoice_id = i.id and e.kind = 'reminder') as last_step,
           exists (select 1 from public.document_emails e
                   where e.invoice_id = i.id and e.kind = 'reminder'
                     and e.sent_at >= (p_today::timestamp at time zone 'Asia/Colombo')) as sent_today,
           cfg.days
    from public.invoices i
    join cfg on cfg.workspace = i.workspace
    left join public.clients c on c.id = i.client_id
    where i.kind = 'invoice'
      and i.status in ('issued', 'partially_paid')
      and i.balance_due > 0
      and i.due_date is not null
      and i.due_date < p_today
      and not i.reminders_paused
      and not coalesce(c.reminders_paused, false)
  )
  select o.id, o.workspace,
         -- the latest step whose day has come, past the last one sent
         (select max(n)::integer from generate_subscripts(o.days, 1) n where o.days[n] <= o.late) as step,
         o.late, o.email
  from open_docs o
  where o.email is not null
    and not o.sent_today
    and (select max(n) from generate_subscripts(o.days, 1) n where o.days[n] <= o.late) > coalesce(o.last_step, 0);
$$;

revoke execute on function public.reminders_due(date) from public, anon, authenticated;
grant execute on function public.reminders_due(date) to service_role;

-- 0037's statement, also for the scheduled job (service role; it bypasses
-- RLS and sends the monthly statements). Everyone else still needs Invoices.
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
  if current_user <> 'service_role' and not public.can_access('invoices') then
    raise exception 'You don''t have access to Invoices.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Pick a period that ends on or after the day it starts.' using errcode = '22023';
  end if;
  select * into c from public.clients where id = p_client;
  if not found then
    raise exception 'That client isn''t available.' using errcode = 'P0002';
  end if;

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

-- ───────────────────────────── the job's heartbeat ─────────────────────────
-- When the scheduled job last ran and what it did, so Invoice settings can
-- say whether reminders are actually going out. Written by the job (service
-- role); admins read it.
create table if not exists public.job_runs (
  name        text primary key,
  last_run_at timestamptz not null default now(),
  report      jsonb not null default '{}'::jsonb
);

comment on table public.job_runs is 'Last run of each scheduled job (/api/jobs/run) and its report (0038).';

alter table public.job_runs enable row level security;
revoke all on public.job_runs from anon, authenticated;
grant select on public.job_runs to authenticated;
drop policy if exists "job runs: admins read" on public.job_runs;
create policy "job runs: admins read"
  on public.job_runs for select to authenticated
  using ((select public.is_admin()));
