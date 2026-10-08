-- ============================================================================
-- 0033 · Credit notes, refunds and write-offs
-- Proper reversals instead of voiding.
--
--   Credit note — a third kind of document (kind = 'credit_note'), always
--     against one issued invoice (credited_invoice_id), with a reason. It has
--     lines and taxes like an invoice (a tax credit note), its own numbers
--     (CN-0001, 0030) and three states: draft → issued → void. Issued, it
--     takes its total off the invoice: invoices.credited_total, and
--     balance_due = total − paid − credited. It can't credit more than the
--     invoice has left uncredited. Issued credit notes don't change; void one
--     and make another.
--   Refund — a payment going back (invoice_payments.kind = 'refund'), up to
--     what the client has paid beyond what they now owe. It posts to the
--     ledger as negative income, so profit, the monthly totals and every
--     report net it out with no change of their own.
--   Write-off — an admin closes what's left as bad debt: a credit note for the
--     balance (reason write_off, no tax: bad-debt relief on VAT is claimed on
--     the return, not here), issued at once.
--
-- An invoice's status follows payments and credits together:
--   issued → partially_paid → paid; fully settled by credit alone → credited;
--   settled with a write-off → written_off.
-- Requires: 0032. Idempotent.
-- ============================================================================

-- ─────────────────────────────── columns ───────────────────────────────────
alter table public.invoices
  add column if not exists credited_invoice_id uuid references public.invoices (id) on delete restrict;
alter table public.invoices add column if not exists credit_reason text;
alter table public.invoices add column if not exists credited_total numeric(14, 2) not null default 0;

comment on column public.invoices.credited_invoice_id is 'On a credit note: the invoice it credits.';
comment on column public.invoices.credit_reason is 'On a credit note: return | discount | error | write_off | other.';
comment on column public.invoices.credited_total is
  'On an invoice: the total of its issued credit notes (kept by private.invoice_totals).';

create index if not exists invoices_credited_idx on public.invoices (credited_invoice_id)
  where credited_invoice_id is not null;

alter table public.invoices drop constraint if exists invoices_kind_check;
alter table public.invoices add constraint invoices_kind_check check (kind in ('invoice', 'quote', 'credit_note'));

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check check (
    (kind = 'invoice' and status in ('draft', 'pending_approval', 'issued', 'partially_paid', 'paid',
                                     'credited', 'written_off', 'void'))
    or (kind = 'quote' and status in ('draft', 'sent', 'accepted', 'declined', 'expired', 'converted'))
    or (kind = 'credit_note' and status in ('draft', 'issued', 'void'))
  );

alter table public.invoices drop constraint if exists invoices_credit_check;
alter table public.invoices
  add constraint invoices_credit_check check (
    (kind = 'credit_note') = (credited_invoice_id is not null)
    and (kind = 'credit_note' or credit_reason is null)
    and (credit_reason is null or credit_reason in ('return', 'discount', 'error', 'write_off', 'other'))
    and credited_total >= 0
  );

-- balance_due takes credits off too. A generated column's expression can't be
-- altered: it's replaced, once (nothing else depends on it).
do $$
begin
  if not exists (
    select 1 from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.invoices'::regclass and a.attname = 'balance_due'
      and pg_get_expr(d.adbin, d.adrelid) like '%credited_total%'
  ) then
    alter table public.invoices drop column if exists balance_due;
    alter table public.invoices
      add column balance_due numeric(14, 2) generated always as (total - amount_paid - credited_total) stored;
  end if;
end;
$$;

-- Refunds.
alter table public.invoice_payments add column if not exists kind text not null default 'payment';
alter table public.invoice_payments drop constraint if exists invoice_payments_kind_check;
alter table public.invoice_payments add constraint invoice_payments_kind_check check (kind in ('payment', 'refund'));

comment on column public.invoice_payments.kind is
  'payment (money in) or refund (money back to the client; amount still positive).';

-- A refund's ledger line is negative income: the only rows allowed below zero.
alter table public.finance_entries drop constraint if exists finance_entries_amount_check;
alter table public.finance_entries
  add constraint finance_entries_amount_check check (
    amount > 0 or (amount < 0 and kind = 'income' and invoice_payment_id is not null)
  );

-- ─────────────────────────── credit note rules ─────────────────────────────
-- A credit note belongs to an issued invoice in its own workspace and takes
-- that invoice's client and currency (and its rate, unless one is given).
-- Other kinds never carry credit fields. Definer: the invoice is judged
-- whatever the caller can see.
create or replace function private.guard_credit_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent public.invoices;
begin
  if new.kind <> 'credit_note' then
    if new.credited_invoice_id is not null or new.credit_reason is not null then
      raise exception 'Only a credit note credits an invoice.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status <> 'draft'
     and (new.credited_invoice_id is distinct from old.credited_invoice_id) then
    raise exception 'An issued credit note stays with its invoice.' using errcode = 'check_violation';
  end if;

  select * into parent from public.invoices where id = new.credited_invoice_id;
  if not found or parent.kind <> 'invoice' or parent.workspace <> new.workspace
     or parent.status not in ('issued', 'partially_paid', 'paid', 'credited', 'written_off') then
    raise exception 'A credit note credits an issued invoice — pick one.' using errcode = 'check_violation';
  end if;

  new.credit_reason := coalesce(new.credit_reason, 'other');
  new.currency      := parent.currency;
  new.client_id     := parent.client_id;
  if new.exchange_rate is null then
    new.exchange_rate := parent.exchange_rate;
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_credit_note() from public, anon, authenticated;

drop trigger if exists invoices_credit_note on public.invoices;
create trigger invoices_credit_note
  before insert or update on public.invoices
  for each row execute function private.guard_credit_note();

-- 0013's guard, with credit notes: the API only voids an issued one, and an
-- invoice with credits can't be voided (void its credit notes first).
create or replace function private.guard_invoices()
returns trigger
language plpgsql
security invoker
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only drafts can be deleted — %.',
        case old.kind when 'invoice' then 'void an issued invoice instead'
                      when 'credit_note' then 'void an issued credit note instead'
                      else 'decline or expire it instead' end
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.number is not null then
      raise exception 'New documents start as drafts — Issue numbers them.' using errcode = 'check_violation';
    end if;
    new.issued_at := null;
    return new;
  end if;

  new.issued_at := old.issued_at;
  new.paid_at := old.paid_at;
  new.voided_at := old.voided_at;

  if new.kind is distinct from old.kind then
    raise exception 'A document can''t change into another kind.' using errcode = 'check_violation';
  end if;
  if new.number is distinct from old.number then
    raise exception 'Numbers are assigned when a document is issued.' using errcode = 'check_violation';
  end if;

  if new.kind = 'invoice' then
    if old.status = 'void' then
      raise exception '% is void and can''t be changed.', coalesce(old.number, 'This invoice')
        using errcode = 'check_violation';
    end if;

    if new.status is distinct from old.status then
      if old.status = 'pending_approval' then
        raise exception 'This invoice is waiting for approval — an admin approves or rejects it.'
          using errcode = 'check_violation';
      elsif new.status = 'void' then
        if old.status not in ('issued', 'partially_paid', 'paid', 'credited', 'written_off') then
          raise exception 'Only an issued invoice can be voided — delete a draft instead.'
            using errcode = 'check_violation';
        end if;
        if old.amount_paid > 0 then
          raise exception 'Remove its payments before voiding it.' using errcode = 'check_violation';
        end if;
        if old.credited_total > 0 then
          raise exception 'Void its credit notes before voiding it.' using errcode = 'check_violation';
        end if;
      elsif new.status = 'draft' then
        raise exception 'An issued invoice can''t go back to draft.' using errcode = 'check_violation';
      elsif old.status = 'draft' then
        raise exception 'Use Issue to number and send it.' using errcode = 'check_violation';
      else
        raise exception 'Paid, part paid and credited follow the payments and credit notes — record or remove one instead.'
          using errcode = 'check_violation';
      end if;
    end if;

    if old.amount_paid > 0 or old.credited_total > 0 then
      if new.currency is distinct from old.currency then
        raise exception 'The currency is locked once a payment or credit is recorded.' using errcode = 'check_violation';
      end if;
      if new.client_id is distinct from old.client_id then
        raise exception 'The client is locked once a payment or credit is recorded.' using errcode = 'check_violation';
      end if;
    end if;
  elsif new.kind = 'credit_note' then
    if old.status = 'void' then
      raise exception '% is void and can''t be changed.', coalesce(old.number, 'This credit note')
        using errcode = 'check_violation';
    end if;
    if new.status is distinct from old.status then
      if old.status = 'draft' then
        raise exception 'Use Issue to number and apply it.' using errcode = 'check_violation';
      elsif not (old.status = 'issued' and new.status = 'void') then
        raise exception 'An issued credit note can only be voided.' using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function private.guard_invoices() from public, anon, authenticated;

-- An issued credit note doesn't change (its lines included). AFTER, so it
-- judges the total the totals trigger just worked out; invoker, so only API
-- callers are held to it.
create or replace function private.guard_issued_credit_note()
returns trigger
language plpgsql
security invoker
as $$
begin
  if current_user not in ('authenticated', 'anon') or new.kind <> 'credit_note'
     or old.status <> 'issued' or new.status <> 'issued' then
    return null;
  end if;
  if (new.total, new.currency, new.exchange_rate, new.credit_reason, new.issue_date)
     is distinct from (old.total, old.currency, old.exchange_rate, old.credit_reason, old.issue_date) then
    raise exception '% is issued and can''t change — void it and make a new one.', coalesce(old.number, 'This credit note')
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

revoke execute on function private.guard_issued_credit_note() from public, anon, authenticated;

drop trigger if exists invoices_guard_issued_credit on public.invoices;
create trigger invoices_guard_issued_credit
  after update on public.invoices
  for each row execute function private.guard_issued_credit_note();

-- 0014's quote guard, leaving credit notes to the rules above.
create or replace function private.guard_quotes()
returns trigger
language plpgsql
security invoker
as $$
declare
  api boolean := current_user in ('authenticated', 'anon');
  src public.invoices;
begin
  if tg_op = 'INSERT' then
    if api then
      if new.converted_invoice_id is not null then
        raise exception 'Use Convert to invoice — it copies the quote across.' using errcode = 'check_violation';
      end if;
      if new.source_quote_id is not null then
        select * into src from public.invoices where id = new.source_quote_id;
        if not found or new.kind <> 'invoice' or src.kind <> 'quote'
           or src.status not in ('sent', 'accepted') or src.workspace <> new.workspace then
          raise exception 'Only a sent or accepted quote can become an invoice.' using errcode = 'check_violation';
        end if;
      end if;
    end if;
    return new;
  end if;

  if new.kind = 'quote' and new.status is distinct from old.status then
    if new.status = 'accepted' then
      new.accepted_at := case when api then now() else coalesce(new.accepted_at, now()) end;
    elsif new.status = 'declined' then
      new.declined_at := case when api then now() else coalesce(new.declined_at, now()) end;
    elsif new.status = 'sent' then
      new.accepted_at := null;
      new.declined_at := null;
    end if;
  end if;

  if not api then
    return new;
  end if;

  if new.source_quote_id is distinct from old.source_quote_id then
    raise exception 'The quote an invoice came from can''t be changed.' using errcode = 'check_violation';
  end if;
  if new.kind <> 'quote' then
    if new.converted_invoice_id is distinct from old.converted_invoice_id then
      raise exception 'Only a quote is converted into an invoice.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.status = 'converted' then
    raise exception '% is already an invoice — edit the invoice instead.', coalesce(old.number, 'This quote')
      using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'draft' then
      raise exception 'A sent quote can''t go back to draft.' using errcode = 'check_violation';
    elsif new.status = 'converted' then
      if old.status not in ('sent', 'accepted')
         or new.converted_invoice_id is null
         or not exists (
           select 1 from public.invoices i
           where i.id = new.converted_invoice_id and i.source_quote_id = new.id
         ) then
        raise exception 'Use Convert to invoice — it copies the quote across.' using errcode = 'check_violation';
      end if;
    elsif old.status = 'draft' then
      raise exception 'Send the quote first — that numbers it.' using errcode = 'check_violation';
    end if;
  end if;

  if new.status <> 'converted' and new.converted_invoice_id is distinct from old.converted_invoice_id then
    raise exception 'Use Convert to invoice — it copies the quote across.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_quotes() from public, anon, authenticated;

-- ─────────────────────────────── totals ────────────────────────────────────
-- 0032's maths, plus: payments net of refunds, the invoice's credits, and the
-- status that follows from both.
create or replace function private.invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub      numeric(14, 2);
  v_discount numeric(14, 2);
  v_after    numeric(14, 2);
  v_taxed    integer;
  v_tax      numeric(14, 2) := 0;
  v_amount   numeric(14, 2);
  v_base     numeric(14, 2);
  v_list     jsonb := '[]'::jsonb;
  v_writeoff numeric(14, 2) := 0;
  g          record;
begin
  select coalesce(sum(i.amount), 0), count(*) filter (where jsonb_array_length(i.taxes) > 0)
  into v_sub, v_taxed
  from public.invoice_items i where i.invoice_id = new.id;
  select coalesce(sum(case when p.kind = 'refund' then -p.amount else p.amount end), 0)
  into new.amount_paid
  from public.invoice_payments p where p.invoice_id = new.id;

  if new.kind = 'invoice' then
    select coalesce(sum(c.total), 0), coalesce(sum(c.total) filter (where c.credit_reason = 'write_off'), 0)
    into new.credited_total, v_writeoff
    from public.invoices c
    where c.credited_invoice_id = new.id and c.kind = 'credit_note' and c.status = 'issued';
  else
    new.credited_total := 0;
  end if;

  v_discount := case when new.discount_type = 'percent'
                     then round(v_sub * new.discount_value / 100, 2)
                     else new.discount_value end;
  new.subtotal       := v_sub;
  new.discount_total := least(greatest(v_discount, 0), v_sub);
  v_after            := v_sub - new.discount_total;

  if v_taxed > 0 then
    if v_sub > 0 then
      for g in
        with lines as (
          select i.position, i.amount as amt, i.taxes,
                 coalesce((select sum((t.x ->> 'rate')::numeric) from jsonb_array_elements(i.taxes) t(x)
                           where not coalesce((t.x ->> 'compound')::boolean, false)), 0) as r_nc,
                 coalesce((select sum((t.x ->> 'rate')::numeric) from jsonb_array_elements(i.taxes) t(x)
                           where coalesce((t.x ->> 'compound')::boolean, false)), 0) as r_c
          from public.invoice_items i
          where i.invoice_id = new.id
        ),
        shares as (
          select btrim(x.t ->> 'name') as name,
                 (x.t ->> 'rate')::numeric as rate,
                 coalesce((x.t ->> 'compound')::boolean, false) as compound,
                 l.position * 100 + x.ord as seen,
                 l.amt, l.r_nc, l.r_c
          from lines l, jsonb_array_elements(l.taxes) with ordinality as x(t, ord)
        )
        select s.name, s.rate, s.compound, min(s.seen) as seen,
               sum(case when s.compound then s.amt * (100 + s.r_nc) else s.amt * 100 end) as excl,
               sum(case when s.compound then s.amt * 100 / (100 + s.r_c)
                        else s.amt * 10000 / ((100 + s.r_nc) * (100 + s.r_c)) end) as incl
        from shares s
        group by s.name, s.rate, s.compound
        -- plain taxes first, then those charged on them (SSCL before VAT)
        order by s.compound, min(s.seen)
      loop
        if new.prices_include_tax then
          v_base   := round(g.incl * v_after / v_sub, 2);
          v_amount := round(g.incl * v_after * g.rate / (v_sub * 100), 2);
        else
          v_base   := round(g.excl * v_after / (v_sub * 100), 2);
          v_amount := round(g.excl * v_after * g.rate / (v_sub * 10000), 2);
        end if;
        v_tax := v_tax + v_amount;
        v_list := v_list || jsonb_build_array(jsonb_build_object(
          'name', g.name, 'rate', g.rate, 'compound', g.compound, 'base', v_base, 'amount', v_amount));
      end loop;
    end if;
    new.tax_total     := v_tax;
    new.tax_breakdown := v_list;
    new.total         := case when new.prices_include_tax then v_after else v_after + v_tax end;
  else
    new.tax_total     := round(v_after * new.tax_rate / 100, 2);
    new.total         := v_after + new.tax_total;
    new.tax_breakdown := case when new.tax_rate > 0
      then jsonb_build_array(jsonb_build_object(
             'name', new.tax_label, 'rate', new.tax_rate, 'compound', false, 'base', v_after, 'amount', new.tax_total))
      else '[]'::jsonb end;
  end if;

  if new.amount_paid > new.total then
    raise exception 'The total can''t drop below the % already paid. Remove a payment first.',
      private.money(new.amount_paid, new.currency)
      using errcode = 'check_violation';
  end if;
  if new.kind = 'invoice' and new.credited_total > new.total then
    raise exception 'The total can''t drop below the % already credited. Void a credit note first.',
      private.money(new.credited_total, new.currency)
      using errcode = 'check_violation';
  end if;

  if new.kind = 'invoice' and new.status in ('issued', 'partially_paid', 'paid', 'credited', 'written_off') then
    new.status := case
      when new.amount_paid + new.credited_total >= new.total then
        case when v_writeoff > 0 then 'written_off'
             when new.credited_total > 0 and new.amount_paid = 0 then 'credited'
             else 'paid' end
      when new.amount_paid > 0 or new.credited_total > 0 then 'partially_paid'
      else 'issued'
    end;
  end if;

  new.paid_at := case
    when new.kind <> 'invoice' or new.status <> 'paid' then null
    when tg_op = 'UPDATE' and old.status = 'paid' then coalesce(old.paid_at, now())
    else coalesce(new.paid_at, now())
  end;
  new.voided_at := case
    when new.status <> 'void' then null
    when tg_op = 'UPDATE' and old.status = 'void' then coalesce(old.voided_at, now())
    else coalesce(new.voided_at, now())
  end;
  return new;
end;
$$;

revoke execute on function private.invoice_totals() from public, anon, authenticated;

-- A credit note that's issued, voided, changed or removed brings its invoice
-- up to date (the invoice's totals trigger does the sums).
create or replace function private.credit_note_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.kind = 'credit_note' and old.status = 'issued' then
      update public.invoices set updated_at = now() where id = old.credited_invoice_id;
    end if;
    return null;
  end if;
  if new.kind <> 'credit_note' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'issued' then
      update public.invoices set updated_at = now() where id = new.credited_invoice_id;
    end if;
    return null;
  end if;
  if (new.status, new.total, new.credited_invoice_id, new.credit_reason)
     is distinct from (old.status, old.total, old.credited_invoice_id, old.credit_reason)
     and (new.status = 'issued' or old.status = 'issued') then
    update public.invoices set updated_at = now()
    where id in (new.credited_invoice_id, old.credited_invoice_id);
  end if;
  return null;
end;
$$;

revoke execute on function private.credit_note_parent() from public, anon, authenticated;

drop trigger if exists invoices_credit_parent on public.invoices;
create trigger invoices_credit_parent
  after insert or update or delete on public.invoices
  for each row execute function private.credit_note_parent();

drop trigger if exists invoices_activity on public.invoices;
create trigger invoices_activity
  after insert or update or delete on public.invoices
  for each row execute function private.log_activity(
    'invoice', 'number',
    '{subtotal,discount_total,tax_total,total,amount_paid,balance_due,paid_at,tax_breakdown,credited_total}'
  );

-- ────────────────────────────── issuing ────────────────────────────────────
-- 0030's issue_invoice. A credit note needs an amount, and can't credit more
-- than its invoice has left uncredited; it's numbered as a credit note and
-- applied at once.
create or replace function private.issue_invoice(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  doc    public.invoices;
  parent public.invoices;
  room   numeric(14, 2);
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

  if doc.kind = 'credit_note' then
    select * into parent from public.invoices where id = doc.credited_invoice_id for update;
    if not found or parent.kind <> 'invoice'
       or parent.status not in ('issued', 'partially_paid', 'paid', 'credited', 'written_off') then
      raise exception 'A credit note credits an issued invoice — that one isn''t.' using errcode = 'check_violation';
    end if;
    if doc.total <= 0 then
      raise exception 'A credit note needs an amount.' using errcode = 'check_violation';
    end if;
    select parent.total - coalesce(sum(c.total), 0) into room
    from public.invoices c
    where c.credited_invoice_id = parent.id and c.kind = 'credit_note' and c.status = 'issued' and c.id <> doc.id;
    if doc.total > room then
      raise exception 'That''s more than the % left to credit on %.',
        private.money(greatest(room, 0), parent.currency), coalesce(parent.number, 'the invoice')
        using errcode = 'check_violation';
    end if;
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

revoke execute on function private.issue_invoice(uuid) from public, anon, authenticated;

-- 0031's issue_document: writing off is an admin's call.
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
  if doc.kind = 'credit_note' and doc.credit_reason = 'write_off' and not public.is_admin() then
    raise exception 'Only an admin can write off an invoice.' using errcode = '42501';
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

-- ────────────────────────────── write-off ──────────────────────────────────
-- An admin closes what's left on an invoice as bad debt: a credit note for
-- the balance (no tax), issued at once. Returns the credit note's id.
create or replace function public.write_off_invoice(p_invoice uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv   public.invoices;
  v_id  uuid;
  prev  text := coalesce(current_setting('flowstate.invoice_batch', true), '');
begin
  if not (public.can_access('invoices') and public.is_admin()) then
    raise exception 'Only an admin can write off an invoice.' using errcode = '42501';
  end if;
  select * into inv from public.invoices
  where id = p_invoice and workspace = public.current_workspace() and kind = 'invoice'
  for update;
  if not found then
    raise exception 'That invoice isn''t available.' using errcode = 'P0002';
  end if;
  if inv.status not in ('issued', 'partially_paid') or inv.balance_due <= 0 then
    raise exception '% has nothing left to write off.', coalesce(inv.number, 'This invoice')
      using errcode = 'check_violation';
  end if;

  perform set_config('flowstate.invoice_batch', 'on', true);
  insert into public.invoices (
    workspace, kind, status, credited_invoice_id, credit_reason, client_id, lead_id, owner_id,
    bill_to_name, bill_to_company, bill_to_email, bill_to_phone, bill_to_address, bill_to_tax_id,
    subject, issue_date, currency, exchange_rate, notes, created_by
  ) values (
    inv.workspace, 'credit_note', 'draft', inv.id, 'write_off', inv.client_id, inv.lead_id, auth.uid(),
    inv.bill_to_name, inv.bill_to_company, inv.bill_to_email, inv.bill_to_phone, inv.bill_to_address,
    inv.bill_to_tax_id,
    format('Write-off · %s', coalesce(inv.number, 'invoice')), public.local_today(), inv.currency,
    inv.exchange_rate, nullif(btrim(coalesce(p_note, '')), ''), auth.uid()
  )
  returning id into v_id;

  insert into public.invoice_items (invoice_id, position, description, details, quantity, unit_price)
  values (v_id, 0, 'Balance written off', format('Bad debt · %s', coalesce(inv.number, 'invoice')), 1, inv.balance_due);

  perform set_config('flowstate.invoice_batch', prev, true);
  update public.invoices set updated_at = now() where id = v_id;
  perform private.issue_invoice(v_id);

  perform private.log_event(
    inv.workspace, 'invoice_written_off', 'invoice', inv.id, inv.number,
    format('wrote off %s on %s', private.money(inv.balance_due, inv.currency), coalesce(inv.number, 'an invoice'))
  );
  return v_id;
end;
$$;

revoke execute on function public.write_off_invoice(uuid, text) from public, anon, authenticated;
grant execute on function public.write_off_invoice(uuid, text) to authenticated, service_role;

-- ───────────────────────────── save_invoice ────────────────────────────────
-- 0032's function: credit notes too (kind 'credit_note', with the invoice they
-- credit and why).
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
    'payment_details', 'exchange_rate', 'prices_include_tax', 'supply_date', 'bill_to_tax_id',
    'credited_invoice_id', 'credit_reason'
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
    if v_kind not in ('invoice', 'quote', 'credit_note') then
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
    insert into public.invoice_items (invoice_id, position, description, details, quantity, unit_price, taxes)
    select v_id, (e.ord - 1)::integer, btrim(e.item ->> 'description'), nullif(btrim(e.item ->> 'details'), ''),
           coalesce((e.item ->> 'quantity')::numeric, 1), coalesce((e.item ->> 'unit_price')::numeric, 0),
           coalesce(e.item -> 'taxes', '[]'::jsonb)
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

-- ────────────────────────────── payments ───────────────────────────────────
-- 0031's check. A payment can't take more than is left after payments and
-- credits; a refund can't give back more than was paid beyond what's owed.
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
  if tg_op = 'UPDATE' and (new.invoice_id is distinct from old.invoice_id or new.kind is distinct from old.kind) then
    raise exception 'A payment can''t move to another invoice or turn into a refund — remove it and record it again.'
      using errcode = 'check_violation';
  end if;

  select * into inv from public.invoices where id = new.invoice_id for update;
  if not found then
    raise exception 'That invoice doesn''t exist.' using errcode = 'foreign_key_violation';
  end if;
  new.workspace := inv.workspace;

  if inv.kind <> 'invoice' or inv.status not in ('issued', 'partially_paid', 'paid', 'credited', 'written_off') then
    raise exception 'Payments can only be recorded on an issued invoice.' using errcode = 'check_violation';
  end if;

  if inv.currency = 'LKR' then
    new.amount_base := new.amount;
  elsif (new.amount_base is null or new.amount_base <= 0) and inv.exchange_rate is not null then
    new.amount_base := round(new.amount * inv.exchange_rate, 2);
  elsif new.amount_base is null or new.amount_base <= 0 then
    raise exception 'Enter the amount in rupees — Income is kept in LKR.' using errcode = 'check_violation';
  end if;

  select coalesce(sum(case when p.kind = 'refund' then -p.amount else p.amount end), 0) into other
  from public.invoice_payments p
  where p.invoice_id = inv.id and p.id <> new.id;

  if new.kind = 'refund' then
    left_ := other + inv.credited_total - inv.total;
    if left_ <= 0 then
      raise exception 'Nothing to refund — % hasn''t been paid more than is owed.', coalesce(inv.number, 'this invoice')
        using errcode = 'check_violation';
    end if;
    if new.amount > left_ then
      raise exception 'That''s more than the % paid beyond what''s owed.', private.money(left_, inv.currency)
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  left_ := inv.total - inv.credited_total - other;
  if new.amount > left_ then
    if left_ <= 0 then
      raise exception '% is already settled in full.', coalesce(inv.number, 'This invoice')
        using errcode = 'check_violation';
    end if;
    raise exception 'That''s more than the % left to pay.', private.money(left_, inv.currency)
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_invoice_payment() from public, anon, authenticated;

-- 0013's posting: a refund posts negative income ("Refund · INV-0007 · Acme").
create or replace function private.post_invoice_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pay    public.invoice_payments := coalesce(new, old);
  inv    public.invoices;
  paid   numeric(14, 2);
  billed text;
  refund boolean := pay.kind = 'refund';
begin
  select * into inv from public.invoices where id = pay.invoice_id;
  if not found then
    return null;
  end if;

  if tg_op <> 'DELETE' then
    insert into public.finance_entries
      (workspace, kind, entry_date, description, category, amount, currency, method, reference,
       lead_id, invoice_id, invoice_payment_id, created_by)
    values
      (inv.workspace, 'income', new.paid_on,
       case when refund
            then format('Refund · %s · %s', coalesce(inv.number, 'Invoice'),
                        coalesce(nullif(btrim(inv.bill_to_company), ''), nullif(btrim(inv.bill_to_name), ''), 'Client'))
            else private.payment_label(inv.number, inv.bill_to_company, inv.bill_to_name) end,
       'Client project', case when refund then -new.amount_base else new.amount_base end, 'LKR',
       new.method, inv.number, inv.lead_id, inv.id, new.id, new.created_by)
    on conflict (invoice_payment_id) do update
      set entry_date  = excluded.entry_date,
          description = excluded.description,
          amount      = excluded.amount,
          method      = excluded.method,
          reference   = excluded.reference,
          lead_id     = excluded.lead_id;
  end if;

  if not private.flag('invoice_batch') then
    update public.invoices set updated_at = now() where id = inv.id;
  end if;

  if tg_op = 'UPDATE' then
    return null;
  end if;

  if refund then
    perform private.log_event(
      inv.workspace, case when tg_op = 'INSERT' then 'refund_recorded' else 'refund_removed' end,
      'invoice', inv.id, inv.number,
      format('%s a refund of %s on %s', case when tg_op = 'INSERT' then 'recorded' else 'removed' end,
             private.money(pay.amount, inv.currency), coalesce(inv.number, 'an invoice'))
    );
    return null;
  end if;

  select coalesce(sum(case when p.kind = 'refund' then -p.amount else p.amount end), 0) into paid
  from public.invoice_payments p where p.invoice_id = inv.id;
  billed := coalesce(nullif(btrim(inv.bill_to_company), ''), nullif(btrim(inv.bill_to_name), ''));

  if tg_op = 'INSERT' then
    perform private.notify(
      array(
        select u from private.users_with_access('invoices', inv.workspace) u where u = inv.owner_id
        union
        select private.admins_of(inv.workspace)
      ),
      inv.workspace,
      case when paid + inv.credited_total >= inv.total then 'invoice_paid' else 'payment_recorded' end,
      case when paid + inv.credited_total >= inv.total
           then format('%s paid in full', coalesce(inv.number, 'Invoice'))
           else format('Payment received · %s', coalesce(inv.number, 'invoice')) end,
      concat_ws(' · ',
        billed,
        private.money(new.amount, inv.currency) || ' received',
        case when paid + inv.credited_total < inv.total
             then private.money(inv.total - inv.credited_total - paid, inv.currency) || ' left to pay' end
      ),
      '/admin/invoices/' || inv.id,
      'invoice', inv.id
    );
    perform private.log_event(
      inv.workspace, 'payment_recorded', 'invoice', inv.id, inv.number,
      format('recorded a payment of %s on %s', private.money(new.amount, inv.currency), coalesce(inv.number, 'a draft'))
    );
  else
    perform private.log_event(
      inv.workspace, 'payment_removed', 'invoice', inv.id, inv.number,
      format('removed a payment of %s from %s', private.money(old.amount, inv.currency), coalesce(inv.number, 'a draft'))
    );
  end if;
  return null;
end;
$$;

revoke execute on function private.post_invoice_payment() from public, anon, authenticated;

-- 0013's ledger sync, keeping refunds labelled as refunds.
create or replace function private.sync_invoice_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.number, new.bill_to_company, new.bill_to_name, new.lead_id)
     is not distinct from (old.number, old.bill_to_company, old.bill_to_name, old.lead_id) then
    return null;
  end if;
  update public.finance_entries f
  set description = case when p.kind = 'refund'
                         then format('Refund · %s · %s', coalesce(new.number, 'Invoice'),
                                     coalesce(nullif(btrim(new.bill_to_company), ''), nullif(btrim(new.bill_to_name), ''), 'Client'))
                         else private.payment_label(new.number, new.bill_to_company, new.bill_to_name) end,
      reference   = new.number,
      lead_id     = new.lead_id
  from public.invoice_payments p
  where f.invoice_id = new.id and f.invoice_payment_id = p.id;
  return null;
end;
$$;

revoke execute on function private.sync_invoice_ledger() from public, anon, authenticated;

-- ───────────────────────────── headline numbers ────────────────────────────
-- 0031's invoice_kpis: issued credit notes come off what was issued in the
-- period; outstanding is net of credits (balance_due).
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
    select i.kind, i.currency,
           -- private.base_amount, spelled out: this runs as the caller, who can't reach private.*
           (case when i.kind = 'credit_note' then -1 else 1 end)
           * case when i.currency = cfg.currency then i.total
                  when i.exchange_rate is not null then round(i.total * i.exchange_rate, 2) end as total,
           case when i.kind = 'credit_note' then 0
                when i.currency = cfg.currency then i.balance_due
                when i.exchange_rate is not null then round(i.balance_due * i.exchange_rate, 2) end as balance_due,
           i.due_date,
           (p_from is null or i.issue_date >= p_from) and (p_to is null or i.issue_date <= p_to) as in_period,
           i.kind = 'invoice' and i.status in ('issued', 'partially_paid') as open
    from public.invoices i
    cross join cfg
    where i.workspace = public.current_workspace()
      and ((i.kind = 'invoice' and i.status in ('issued', 'partially_paid', 'paid', 'credited', 'written_off'))
           or (i.kind = 'credit_note' and i.status = 'issued'))
  )
  select jsonb_build_object(
    'issued_total',      coalesce(sum(d.total) filter (where d.in_period and d.total is not null), 0),
    'issued_count',      count(*) filter (where d.in_period and d.total is not null and d.kind = 'invoice'),
    'credit_count',      count(*) filter (where d.in_period and d.total is not null and d.kind = 'credit_note'),
    'received_total',    (select coalesce(sum(case when p.kind = 'refund' then -p.amount_base else p.amount_base end), 0)
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

-- ──────────────────────────────── tax report ───────────────────────────────
-- 0032's report: issued credit notes take their tax back off (tax credit notes).
create or replace function public.report_tax(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ws text := public.current_workspace();
begin
  if not public.can_access('reports') then
    raise exception 'You don''t have access to Reports.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Pick a period that ends on or after the day it starts.' using errcode = '22023';
  end if;

  return (
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
end;
$$;

revoke execute on function public.report_tax(date, date) from public, anon, authenticated;
grant execute on function public.report_tax(date, date) to authenticated, service_role;
