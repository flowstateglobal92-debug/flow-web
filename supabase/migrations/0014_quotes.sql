-- ============================================================================
-- 0014 · Quotes
-- A quote is an invoice-shaped document with its own life:
--   draft → sent (numbered QT-0001 by issue_document)
--         → accepted / declined / expired (set by people, back to sent to reopen)
--         → converted (convert_quote_to_invoice copies it into a draft invoice)
-- Same table, items and totals as invoices; `kind` tells them apart and the
-- status check depends on it. A quote's status is never derived and it never
-- takes payments (0013's payment check refuses anything but an issued invoice).
--
-- Converting is once only: the quote is locked while it's copied, and the new
-- invoice's source_quote_id is unique. Deleting that draft invoice hands the
-- quote back (accepted) so it can be converted again.
-- Requires: 0013
-- ============================================================================

-- ───────────────────────── kinds, statuses, columns ─────────────────────────
alter table public.invoices drop constraint if exists invoices_kind_check;
alter table public.invoices add constraint invoices_kind_check check (kind in ('invoice', 'quote'));

-- pending_approval is listed now so 0016 needn't touch this constraint again.
alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check check (
    (kind = 'invoice' and status in ('draft', 'pending_approval', 'issued', 'partially_paid', 'paid', 'void'))
    or (kind = 'quote' and status in ('draft', 'sent', 'accepted', 'declined', 'expired', 'converted'))
  );

alter table public.invoices add column if not exists valid_until date;
alter table public.invoices add column if not exists accepted_at timestamptz;
alter table public.invoices add column if not exists declined_at timestamptz;
-- On the invoice made from a quote.
alter table public.invoices
  add column if not exists source_quote_id uuid unique references public.invoices (id) on delete set null;
-- On the quote, once converted.
alter table public.invoices
  add column if not exists converted_invoice_id uuid references public.invoices (id) on delete set null;

comment on column public.invoices.source_quote_id is 'The quote this invoice was converted from (unique: one invoice per quote).';
comment on column public.invoices.converted_invoice_id is 'On a converted quote: the invoice it became.';

create index if not exists invoices_converted_idx on public.invoices (converted_invoice_id);

-- ──────────────────────────────── guard ────────────────────────────────────
-- Stamps when a quote was answered (for everyone), then holds API callers to
-- the quote's life cycle. Invoker, like 0013's guard: it must see the API role.
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
        -- Read as the caller: the quote must be one they can see, in this workspace.
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
      -- Reopened: the earlier answer no longer stands.
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
  if new.kind = 'invoice' then
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
      -- convert_quote_to_invoice runs as the caller, so it passes here: the
      -- invoice it just made must name this quote as its source.
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

drop trigger if exists invoices_guard_quote on public.invoices;
create trigger invoices_guard_quote
  before insert or update on public.invoices
  for each row execute function private.guard_quotes();

-- ─────────────────────────── accepted → owner ──────────────────────────────
-- A quote handed back after its invoice was deleted (converted → accepted)
-- isn't news.
create or replace function private.notify_quote_accepted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'quote' or new.status <> 'accepted' or old.status in ('accepted', 'converted') then
    return null;
  end if;

  perform private.notify(
    array(select u from private.users_with_access('invoices', new.workspace) u where u = new.owner_id),
    new.workspace,
    'quote_accepted',
    format('Quote accepted · %s', coalesce(new.number, 'draft')),
    concat_ws(' · ',
      coalesce(nullif(btrim(new.bill_to_company), ''), nullif(btrim(new.bill_to_name), '')),
      private.money(new.total, new.currency)
    ),
    '/admin/invoices/' || new.id,
    'invoice', new.id
  );
  return null;
end;
$$;

revoke execute on function private.notify_quote_accepted() from public, anon, authenticated;

drop trigger if exists invoices_quote_accepted on public.invoices;
create trigger invoices_quote_accepted
  after update on public.invoices
  for each row execute function private.notify_quote_accepted();

-- ───────────────────── deleting the draft frees the quote ───────────────────
-- Only drafts can be deleted from the app, so this is "I converted too soon".
create or replace function private.release_converted_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.source_quote_id is not null then
    update public.invoices
    set status = 'accepted', converted_invoice_id = null
    where id = old.source_quote_id and kind = 'quote' and status = 'converted';
  end if;
  return null;
end;
$$;

revoke execute on function private.release_converted_quote() from public, anon, authenticated;

drop trigger if exists invoices_release_quote on public.invoices;
create trigger invoices_release_quote
  after delete on public.invoices
  for each row execute function private.release_converted_quote();

-- ─────────────────────────────── convert ───────────────────────────────────
-- Copy a sent or accepted quote into a new draft invoice dated today (due per
-- the workspace's payment terms). Invoker: RLS and the guards apply. The quote
-- is locked for the whole copy, so two clicks can't make two invoices.
create or replace function public.convert_quote_to_invoice(p_quote uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  q       public.invoices;
  v_id    uuid;
  days    integer;
  v_owner uuid;
  prev    text := coalesce(current_setting('flowstate.invoice_batch', true), '');
begin
  if not public.can_access('invoices') then
    raise exception 'You don''t have access to Invoices.' using errcode = '42501';
  end if;

  select * into q from public.invoices where id = p_quote and kind = 'quote' for update;
  if not found then
    raise exception 'That quote isn''t available.' using errcode = 'P0002';
  end if;
  if q.status = 'converted' then
    raise exception '% is already an invoice.', coalesce(q.number, 'This quote') using errcode = 'check_violation';
  end if;
  if q.status not in ('sent', 'accepted') then
    raise exception 'Only a sent or accepted quote can become an invoice.' using errcode = 'check_violation';
  end if;

  select s.default_due_days into days from public.invoice_settings s where s.workspace = q.workspace;
  -- Keep the quote's owner if they can still open Invoices; otherwise it's yours.
  v_owner := case
    when q.owner_id is not null and (q.owner_id = auth.uid() or public.user_can_access(q.owner_id, 'invoices'))
      then q.owner_id
    else auth.uid()
  end;

  perform set_config('flowstate.invoice_batch', 'on', true);

  insert into public.invoices (
    kind, client_id, lead_id, owner_id, bill_to_name, bill_to_company, bill_to_email, bill_to_phone,
    bill_to_address, subject, issue_date, due_date, currency, discount_type, discount_value, tax_label,
    tax_rate, notes, terms, payment_details, source_quote_id
  ) values (
    'invoice', q.client_id, q.lead_id, v_owner, q.bill_to_name, q.bill_to_company, q.bill_to_email, q.bill_to_phone,
    q.bill_to_address, q.subject, public.local_today(), public.local_today() + coalesce(days, 14), q.currency,
    q.discount_type, q.discount_value, q.tax_label, q.tax_rate, q.notes, q.terms, q.payment_details, q.id
  )
  returning id into v_id;

  insert into public.invoice_items (invoice_id, position, description, details, quantity, unit_price)
  select v_id, i.position, i.description, i.details, i.quantity, i.unit_price
  from public.invoice_items i
  where i.invoice_id = q.id
  order by i.position, i.created_at;

  perform set_config('flowstate.invoice_batch', prev, true);
  update public.invoices set updated_at = now() where id = v_id;

  update public.invoices set status = 'converted', converted_invoice_id = v_id where id = q.id;
  return v_id;
end;
$$;

revoke execute on function public.convert_quote_to_invoice(uuid) from public, anon, authenticated;
grant execute on function public.convert_quote_to_invoice(uuid) to authenticated, service_role;
