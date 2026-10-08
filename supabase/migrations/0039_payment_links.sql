-- ============================================================================
-- 0039 · Pay-online links
-- A link on an invoice (and in its email) that opens a payment page on the
-- website: PayHere for rupees (and the other currencies PayHere takes),
-- Stripe for the rest. A successful payment is recorded on the invoice like
-- any other — it posts to Income — once the provider confirms it to the
-- website (never from the browser alone).
--
--   invoices.pay_token — the link's secret (32 hex characters), made the first
--     time a link is asked for (invoice_pay_link) and never changed by the
--     API. Whoever has the link can see the invoice's amount and pay it.
--   invoice_settings.online_payments / payhere_enabled / stripe_enabled — off
--     until an admin switches them on. The providers' keys live in the
--     website's environment (PAYHERE_*, STRIPE_*), never here.
--   payment_page(token), record_online_payment(…) — what the public page and
--     the providers' notifications use, through the website's server with the
--     service role. Nobody else can call them.
-- Requires: 0038. Idempotent.
-- ============================================================================

alter table public.invoices add column if not exists pay_token text;
create unique index if not exists invoices_pay_token_key on public.invoices (pay_token) where pay_token is not null;

comment on column public.invoices.pay_token is 'The pay-online link''s secret (0039). Set by invoice_pay_link(); the API can''t change it.';

alter table public.invoice_settings add column if not exists online_payments boolean not null default false;
alter table public.invoice_settings add column if not exists payhere_enabled boolean not null default false;
alter table public.invoice_settings add column if not exists stripe_enabled boolean not null default false;

-- Online payments are recorded once per provider reference.
create unique index if not exists invoice_payments_online_key
  on public.invoice_payments (invoice_id, method, reference)
  where method in ('PayHere', 'Card (Stripe)') and reference is not null;

-- The token is the database's: API callers keep whatever it was.
create or replace function private.keep_pay_token()
returns trigger
language plpgsql
security invoker
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.pay_token := case when tg_op = 'UPDATE' then old.pay_token end;
  end if;
  return new;
end;
$$;

revoke execute on function private.keep_pay_token() from public, anon, authenticated;

drop trigger if exists invoices_keep_pay_token on public.invoices;
create trigger invoices_keep_pay_token
  before insert or update on public.invoices
  for each row execute function private.keep_pay_token();

-- The link for an issued invoice the caller can see: made once, then the same.
create or replace function public.invoice_pay_link(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  doc public.invoices;
  cfg public.invoice_settings;
begin
  if not public.can_access('invoices') then
    raise exception 'You don''t have access to Invoices.' using errcode = '42501';
  end if;
  select * into doc from public.invoices
  where id = p_id and workspace = public.current_workspace() and kind = 'invoice'
  for update;
  if not found then
    raise exception 'That invoice isn''t available.' using errcode = 'P0002';
  end if;
  select * into cfg from public.invoice_settings where workspace = doc.workspace;
  if not coalesce(cfg.online_payments, false) then
    raise exception 'Online payment is switched off — an admin turns it on in Invoice settings.' using errcode = 'check_violation';
  end if;
  if doc.workspace <> 'live' then
    raise exception 'The demo can''t take payments.' using errcode = 'check_violation';
  end if;
  if doc.status not in ('issued', 'partially_paid') then
    raise exception 'Only an issued invoice with something left to pay has a payment link.' using errcode = 'check_violation';
  end if;
  if doc.pay_token is null then
    update public.invoices set pay_token = replace(gen_random_uuid()::text, '-', '')
    where id = p_id
    returning * into doc;
  end if;
  return doc.pay_token;
end;
$$;

revoke execute on function public.invoice_pay_link(uuid) from public, anon, authenticated;
grant execute on function public.invoice_pay_link(uuid) to authenticated, service_role;

-- What the public payment page shows. Null when the token doesn't match an
-- invoice that can be paid online.
create or replace function public.payment_page(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'invoice_id', i.id,
    'number', i.number,
    'status', i.status,
    'currency', i.currency,
    'total', i.total,
    'balance_due', i.balance_due,
    'exchange_rate', i.exchange_rate,
    'due_date', i.due_date,
    'issue_date', i.issue_date,
    'subject', i.subject,
    'bill_to_name', i.bill_to_name,
    'bill_to_company', i.bill_to_company,
    'bill_to_email', i.bill_to_email,
    'bill_to_phone', i.bill_to_phone,
    'bill_to_address', i.bill_to_address,
    'business_name', s.business_name,
    'business_email', s.business_email,
    'logo_mode', s.logo_mode,
    'logo_data', s.logo_data,
    'accent_color', s.accent_color,
    'payhere', s.payhere_enabled,
    'stripe', s.stripe_enabled
  )
  from public.invoices i
  join public.invoice_settings s on s.workspace = i.workspace
  where p_token ~ '^[0-9a-f]{32}$'
    and i.pay_token = p_token
    and i.kind = 'invoice'
    and i.workspace = 'live'
    and s.online_payments;
$$;

revoke execute on function public.payment_page(text) from public, anon, authenticated;
grant execute on function public.payment_page(text) to service_role;

-- A provider confirmed a payment: record it on the invoice (in its currency;
-- in rupees as given, or at the invoice's rate). The same provider reference
-- twice is the same payment — the second call changes nothing. More than
-- what's left is recorded up to what's left (a refund settles the rest).
create or replace function public.record_online_payment(
  p_token text, p_provider text, p_reference text, p_amount numeric, p_currency text,
  p_amount_base numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv     public.invoices;
  v_method text := case p_provider when 'payhere' then 'PayHere' when 'stripe' then 'Card (Stripe)' end;
  amt     numeric(14, 2);
  base    numeric(14, 2);
  left_   numeric(14, 2);
  pay_id  uuid;
begin
  if v_method is null or nullif(btrim(p_reference), '') is null or p_amount is null or p_amount <= 0 then
    raise exception 'Not a payment.' using errcode = '22023';
  end if;
  select * into inv from public.invoices where pay_token = p_token and kind = 'invoice' for update;
  if not found then
    raise exception 'No invoice for that link.' using errcode = 'P0002';
  end if;
  if upper(p_currency) <> inv.currency then
    raise exception 'Paid in % on a % invoice.', upper(p_currency), inv.currency using errcode = 'check_violation';
  end if;

  select p.id into pay_id from public.invoice_payments p
  where p.invoice_id = inv.id and p.method = v_method and p.reference = btrim(p_reference);
  if found then
    return jsonb_build_object('status', 'duplicate', 'payment_id', pay_id);
  end if;

  left_ := inv.total - inv.amount_paid - inv.credited_total;
  if left_ <= 0 then
    return jsonb_build_object('status', 'already_paid');
  end if;
  amt := least(round(p_amount, 2), left_);
  base := case when inv.currency = 'LKR' then amt
               when p_amount_base is not null and p_amount_base > 0 then round(p_amount_base * amt / round(p_amount, 2), 2)
               when inv.exchange_rate is not null then round(amt * inv.exchange_rate, 2) end;
  if base is null then
    raise exception 'No rupee amount for a % payment — set the invoice''s exchange rate.', inv.currency using errcode = 'check_violation';
  end if;

  insert into public.invoice_payments (invoice_id, kind, amount, amount_base, paid_on, method, reference, note)
  values (inv.id, 'payment', amt, base, public.local_today(), v_method, btrim(p_reference),
          case when round(p_amount, 2) > left_ then format('Paid %s online; recorded up to the balance.', round(p_amount, 2)) end)
  returning id into pay_id;

  return jsonb_build_object('status', 'recorded', 'payment_id', pay_id, 'amount', amt);
end;
$$;

revoke execute on function public.record_online_payment(text, text, text, numeric, text, numeric) from public, anon, authenticated;
grant execute on function public.record_online_payment(text, text, text, numeric, text, numeric) to service_role;
