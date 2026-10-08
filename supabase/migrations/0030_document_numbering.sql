-- ============================================================================
-- 0030 · Document numbering
-- Numbers follow a pattern each workspace chooses, instead of the fixed
-- PREFIX-0001. The default pattern gives exactly the numbers 0013 gave.
--
--   Tokens:  {PREFIX}  the kind's prefix (INV, QT, CN)
--            {YYYY} {YY} {MM} {MON}   the document's date (MON = JUL)
--            {FY}      the tax year it falls in, e.g. 2026-27 (April start)
--            {SEQ}     the running number; {SEQ:4} pads it to 4 digits
--   Examples: INV-{YYYY}-{SEQ:4}  → INV-2026-0001
--             {YY}{MON}_BR03_{SEQ} → 26JUL_BR03_1 (Sri Lanka's tax-invoice
--                                    serial from 1 July 2026: continuous, no
--                                    spaces, 40 characters at most)
--
--   Reset:   never (one running count, the default) · year · tax_year · month.
--            'never' keeps counting in invoice_settings.next_*_number, as
--            before; the others keep one counter per period in
--            document_counters, so a back-dated document takes the next
--            number of its own period.
--
-- The next number can be changed by an admin (set_next_document_number), and
-- next_document_number() previews it without using it up. Credit notes (0033)
-- get their own prefix, pattern and counter here, so numbering is complete in
-- one place. allocate_number gains the document's date (it numbers by the
-- issue date); its two-argument form is dropped.
-- Requires: 0029. Idempotent.
-- ============================================================================

-- ───────────────────────────── settings columns ────────────────────────────
alter table public.invoice_settings add column if not exists invoice_number_format text not null default '{PREFIX}-{SEQ:4}';
alter table public.invoice_settings add column if not exists quote_number_format text not null default '{PREFIX}-{SEQ:4}';
alter table public.invoice_settings add column if not exists credit_note_prefix text not null default 'CN';
alter table public.invoice_settings add column if not exists credit_note_number_format text not null default '{PREFIX}-{SEQ:4}';
alter table public.invoice_settings add column if not exists next_credit_note_number integer not null default 1;
alter table public.invoice_settings add column if not exists number_reset text not null default 'never';
-- 4 = April: Sri Lanka's year of assessment runs April–March. Reports (0031)
-- use it for "Tax year" too.
alter table public.invoice_settings add column if not exists fiscal_year_start_month smallint not null default 4;

comment on column public.invoice_settings.invoice_number_format is
  'Pattern for invoice numbers: {PREFIX} {YYYY} {YY} {MM} {MON} {FY} {SEQ} {SEQ:n}. Must contain {SEQ}.';
comment on column public.invoice_settings.number_reset is
  'When the running number starts again at 1: never | year | tax_year | month.';
comment on column public.invoice_settings.fiscal_year_start_month is
  'First month of the tax/financial year (4 = April, Sri Lanka).';

alter table public.invoice_settings drop constraint if exists invoice_settings_numbering_check;
alter table public.invoice_settings
  add constraint invoice_settings_numbering_check check (
    number_reset in ('never', 'year', 'tax_year', 'month')
    and fiscal_year_start_month between 1 and 12
    and next_credit_note_number >= 1
    and btrim(credit_note_prefix) <> ''
    and char_length(invoice_number_format) between 5 and 60
    and char_length(quote_number_format) between 5 and 60
    and char_length(credit_note_number_format) between 5 and 60
    and position('{SEQ' in invoice_number_format) > 0
    and position('{SEQ' in quote_number_format) > 0
    and position('{SEQ' in credit_note_number_format) > 0
  );

-- The counters tick on every issue: not worth an audit line each.
drop trigger if exists invoice_settings_activity on public.invoice_settings;
create trigger invoice_settings_activity
  after update on public.invoice_settings
  for each row execute function private.log_activity(
    'invoice settings', 'business_name', '{next_invoice_number,next_quote_number,next_credit_note_number}'
  );

-- ───────────────────────────── period counters ─────────────────────────────
-- One row per workspace, kind and period ('2026', 'FY2026', '2026-07').
-- Only the numbering functions touch it: nothing in the API can read or write
-- it (next_document_number shows what's next).
create table if not exists public.document_counters (
  workspace   text not null references public.workspaces (id),
  kind        text not null,
  period      text not null,
  next_number integer not null default 1,
  primary key (workspace, kind, period)
);

comment on table public.document_counters is
  'Next document number per period when numbering restarts each year, tax year or month (0030).';

alter table public.document_counters drop constraint if exists document_counters_values_check;
alter table public.document_counters
  add constraint document_counters_values_check check (
    kind in ('invoice', 'quote', 'credit_note') and next_number >= 1 and btrim(period) <> ''
  );

alter table public.document_counters enable row level security;
revoke all on public.document_counters from anon, authenticated;
drop policy if exists "workspace fence" on public.document_counters;
create policy "workspace fence" on public.document_counters as restrictive for all to authenticated
  using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
  with check (workspace = (select public.current_workspace()) and (select public.is_active_member()));

-- ───────────────────────────── the pattern ─────────────────────────────────
-- Which counter a date uses: '' (never resets), '2026', 'FY2026' or '2026-07'.
create or replace function private.number_period(p_reset text, p_date date, p_fy_start integer)
returns text
language sql
stable
as $$
  select case p_reset
    when 'year' then to_char(p_date, 'YYYY')
    when 'month' then to_char(p_date, 'YYYY-MM')
    when 'tax_year' then 'FY' || (
      extract(year from p_date)::integer
      - case when extract(month from p_date)::integer >= coalesce(p_fy_start, 4) then 0 else 1 end
    )::text
    else ''
  end;
$$;

-- The number itself. Same output as src/lib/admin/numbering.ts.
create or replace function private.format_document_number(
  p_format text, p_prefix text, p_seq integer, p_date date, p_fy_start integer
)
returns text
language plpgsql
stable
as $$
declare
  v      text := coalesce(nullif(p_format, ''), '{PREFIX}-{SEQ:4}');
  fs     integer := coalesce(p_fy_start, 4);
  fy     integer := extract(year from p_date)::integer
                    - case when extract(month from p_date)::integer >= coalesce(p_fy_start, 4) then 0 else 1 end;
  months constant text[] := array['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  width  text;
begin
  v := replace(v, '{PREFIX}', btrim(coalesce(p_prefix, '')));
  v := replace(v, '{YYYY}', to_char(p_date, 'YYYY'));
  v := replace(v, '{YY}', to_char(p_date, 'YY'));
  v := replace(v, '{MM}', to_char(p_date, 'MM'));
  v := replace(v, '{MON}', months[extract(month from p_date)::integer]);
  v := replace(v, '{FY}', case when fs = 1 then fy::text else fy::text || '-' || lpad(((fy + 1) % 100)::text, 2, '0') end);
  loop
    width := substring(v from '\{SEQ:([0-9]{1,2})\}');
    exit when width is null;
    v := regexp_replace(v, '\{SEQ:' || width || '\}', lpad(p_seq::text, greatest(width::integer, length(p_seq::text)), '0'));
  end loop;
  return replace(v, '{SEQ}', p_seq::text);
end;
$$;

-- ───────────────────────────── allocation ──────────────────────────────────
-- Next free number for a kind on a date, under a lock on the settings row.
-- Numbers typed in by a trusted path (import, seed) are skipped, never
-- reused. p_consume = false only looks (the preview).
drop function if exists private.allocate_number(text, text);

create or replace function private.allocate_number(
  p_workspace text, p_kind text, p_date date default null, p_consume boolean default true
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg      public.invoice_settings;
  v_date   date := coalesce(p_date, public.local_today());
  v_prefix text;
  v_format text;
  v_period text;
  n        integer;
  v        text;
begin
  insert into public.invoice_settings (workspace) values (p_workspace) on conflict do nothing;
  select * into cfg from public.invoice_settings where workspace = p_workspace for update;

  v_prefix := case p_kind when 'quote' then cfg.quote_prefix when 'credit_note' then cfg.credit_note_prefix
                          else cfg.invoice_prefix end;
  v_format := case p_kind when 'quote' then cfg.quote_number_format
                          when 'credit_note' then cfg.credit_note_number_format
                          else cfg.invoice_number_format end;
  v_period := private.number_period(cfg.number_reset, v_date, cfg.fiscal_year_start_month);

  if v_period = '' then
    n := case p_kind when 'quote' then cfg.next_quote_number when 'credit_note' then cfg.next_credit_note_number
                     else cfg.next_invoice_number end;
  else
    if p_consume then
      insert into public.document_counters (workspace, kind, period) values (p_workspace, p_kind, v_period)
      on conflict do nothing;
    end if;
    select c.next_number into n from public.document_counters c
    where c.workspace = p_workspace and c.kind = p_kind and c.period = v_period
    for update;
    n := coalesce(n, 1);
  end if;

  loop
    v := private.format_document_number(v_format, v_prefix, n, v_date, cfg.fiscal_year_start_month);
    exit when not exists (
      select 1 from public.invoices i where i.workspace = p_workspace and i.kind = p_kind and i.number = v
    );
    n := n + 1;
  end loop;

  if p_consume then
    if v_period = '' then
      update public.invoice_settings
      set next_invoice_number     = case when p_kind = 'invoice' then n + 1 else next_invoice_number end,
          next_quote_number       = case when p_kind = 'quote' then n + 1 else next_quote_number end,
          next_credit_note_number = case when p_kind = 'credit_note' then n + 1 else next_credit_note_number end
      where workspace = p_workspace;
    else
      update public.document_counters set next_number = n + 1
      where workspace = p_workspace and kind = p_kind and period = v_period;
    end if;
  end if;
  return v;
end;
$$;

-- 0013's issue_invoice, numbering by the document's own date.
create or replace function private.issue_invoice(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  doc public.invoices;
begin
  select * into doc from public.invoices where id = p_id for update;
  if not found then
    raise exception 'That document isn''t available.' using errcode = 'P0002';
  end if;
  if doc.status not in ('draft', 'pending_approval') then
    raise exception '% has already been issued.', coalesce(doc.number, 'This document')
      using errcode = 'check_violation';
  end if;
  if btrim(doc.bill_to_name) = '' then
    raise exception 'Add who this is billed to before issuing it.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.invoice_items where invoice_id = p_id) then
    raise exception 'Add at least one line item before issuing it.' using errcode = 'check_violation';
  end if;

  update public.invoices
  set number    = coalesce(doc.number, private.allocate_number(doc.workspace, doc.kind, doc.issue_date)),
      status    = case when doc.kind = 'quote' then 'sent' else 'issued' end,
      issued_at = coalesce(doc.issued_at, now())
  where id = p_id
  returning * into doc;

  return jsonb_build_object('status', doc.status, 'number', doc.number);
end;
$$;

revoke execute on function private.number_period(text, date, integer),
  private.format_document_number(text, text, integer, date, integer),
  private.allocate_number(text, text, date, boolean),
  private.issue_invoice(uuid)
  from public, anon, authenticated;

-- ───────────────────────────── the API ─────────────────────────────────────
-- What the next document of a kind will be numbered, if issued today.
create or replace function public.next_document_number(p_kind text default 'invoice')
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.can_access('invoices') or public.can_access('reports')) then
    raise exception 'You don''t have access to Invoices.' using errcode = '42501';
  end if;
  if p_kind not in ('invoice', 'quote', 'credit_note') then
    raise exception 'Unknown document type.' using errcode = '22023';
  end if;
  return private.allocate_number(public.current_workspace(), p_kind, public.local_today(), false);
end;
$$;

-- Admins: the running number the next document of a kind starts from (in the
-- current period, when numbering resets). A number already used is skipped
-- when it comes up, so setting it lower can't produce duplicates.
create or replace function public.set_next_document_number(p_kind text, p_next integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  ws       text := public.current_workspace();
  cfg      public.invoice_settings;
  v_period text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change document numbering.' using errcode = '42501';
  end if;
  if p_kind not in ('invoice', 'quote', 'credit_note') then
    raise exception 'Unknown document type.' using errcode = '22023';
  end if;
  if p_next is null or p_next < 1 or p_next > 99999999 then
    raise exception 'The next number must be between 1 and 99,999,999.' using errcode = 'check_violation';
  end if;

  insert into public.invoice_settings (workspace) values (ws) on conflict do nothing;
  select * into cfg from public.invoice_settings where workspace = ws for update;
  v_period := private.number_period(cfg.number_reset, public.local_today(), cfg.fiscal_year_start_month);

  if v_period = '' then
    update public.invoice_settings
    set next_invoice_number     = case when p_kind = 'invoice' then p_next else next_invoice_number end,
        next_quote_number       = case when p_kind = 'quote' then p_next else next_quote_number end,
        next_credit_note_number = case when p_kind = 'credit_note' then p_next else next_credit_note_number end
    where workspace = ws;
  else
    insert into public.document_counters (workspace, kind, period, next_number)
    values (ws, p_kind, v_period, p_next)
    on conflict (workspace, kind, period) do update set next_number = excluded.next_number;
  end if;

  perform private.log_event(
    ws, 'numbering_changed', 'invoice settings', null, cfg.business_name,
    format('set the next %s number to %s', replace(p_kind, '_', ' '), p_next)
  );
  return private.allocate_number(ws, p_kind, public.local_today(), false);
end;
$$;

revoke execute on function public.next_document_number(text), public.set_next_document_number(text, integer)
  from public, anon, authenticated;
grant execute on function public.next_document_number(text), public.set_next_document_number(text, integer)
  to authenticated, service_role;
