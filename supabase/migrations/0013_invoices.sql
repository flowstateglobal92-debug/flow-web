-- ============================================================================
-- 0013 · Invoices
-- Invoices, their line items and the payments against them, plus the
-- per-workspace settings that print on the paper and number the documents.
--
-- The database does the bookkeeping so no screen can get it wrong:
--   · totals (subtotal → discount → tax → total) and amount_paid are derived
--     by a BEFORE trigger on every write; balance_due is a generated column.
--     The maths matches computeTotals() in src/lib/admin/invoice-math.ts to
--     the cent (PARITY_FIXTURE there is asserted by the harness).
--   · an issued invoice's status follows its payments: issued → partially_paid
--     → paid. Item and payment triggers only touch the parent row; save_invoice
--     sets flowstate.invoice_batch so a save recomputes once, not once per line.
--   · every payment posts itself to the ledger as LKR income (amount_base) and
--     the API can't edit or delete that income except through the payment.
--   · numbers are handed out by issue_document under a row lock, skipping any
--     number already taken. Drafts have none.
--
-- Guards are invoker triggers that only restrict API callers (current_user
-- authenticated/anon); definer functions, the service role, the seed and the
-- import are trusted. Invoker code can't reach the private schema, so the
-- guards only use public helpers and read flags with current_setting().
-- Requires: 0012
-- ============================================================================

-- ─────────────────────────────── settings ──────────────────────────────────
create table if not exists public.invoice_settings (
  workspace           text primary key default public.current_workspace() references public.workspaces (id),
  business_name       text not null default 'Flow State',
  business_email      text default 'support@flowstate.lk',
  business_phone      text,
  business_address    text,
  business_website    text default 'www.flowstate.lk',
  tax_id              text,
  default_currency    text not null default 'LKR',
  tax_label           text not null default 'VAT',
  default_tax_rate    numeric(5, 2) not null default 0,
  default_due_days    integer not null default 14,
  default_notes       text,
  default_terms       text,
  payment_details     text,                  -- bank block printed on every invoice
  invoice_prefix      text not null default 'INV',
  quote_prefix        text not null default 'QT',
  next_invoice_number integer not null default 1,
  next_quote_number   integer not null default 1,
  updated_at          timestamptz not null default now()
);

comment on table public.invoice_settings is
  'One row per workspace: the business block, defaults and the next document numbers.';

alter table public.invoice_settings drop constraint if exists invoice_settings_values_check;
alter table public.invoice_settings
  add constraint invoice_settings_values_check check (
    default_tax_rate between 0 and 100
    and default_due_days between 0 and 365
    and next_invoice_number >= 1
    and next_quote_number >= 1
    and btrim(invoice_prefix) <> ''
    and btrim(quote_prefix) <> ''
    and default_currency ~ '^[A-Z]{3}$'
  );

insert into public.invoice_settings (workspace) values ('live'), ('demo')
on conflict do nothing;

drop trigger if exists invoice_settings_set_updated_at on public.invoice_settings;
create trigger invoice_settings_set_updated_at
  before update on public.invoice_settings
  for each row execute function public.set_updated_at();

alter table public.invoice_settings enable row level security;

drop policy if exists "workspace fence" on public.invoice_settings;
create policy "workspace fence" on public.invoice_settings as restrictive for all to authenticated
  using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
  with check (workspace = (select public.current_workspace()) and (select public.is_active_member()));

-- Reports prints the business name too; only admins change it. The rows are
-- seeded above and never created or removed through the API.
drop policy if exists "invoice settings: read" on public.invoice_settings;
create policy "invoice settings: read"
  on public.invoice_settings for select to authenticated
  using ((select public.can_access('invoices')) or (select public.can_access('reports')));

drop policy if exists "invoice settings: admins update" on public.invoice_settings;
create policy "invoice settings: admins update"
  on public.invoice_settings for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on public.invoice_settings from anon;
revoke insert, delete, truncate on public.invoice_settings from authenticated;

-- Bank details are worth an audit trail; the counters tick on every issue and aren't.
drop trigger if exists invoice_settings_activity on public.invoice_settings;
create trigger invoice_settings_activity
  after update on public.invoice_settings
  for each row execute function private.log_activity(
    'invoice settings', 'business_name', '{next_invoice_number,next_quote_number}'
  );

-- ─────────────────────────────── invoices ──────────────────────────────────
-- kind/status checks are inline so they only exist from the first run: 0014
-- widens both, and re-running this file must not narrow them again.
create table if not exists public.invoices (
  id               uuid primary key default gen_random_uuid(),
  workspace        text not null default public.current_workspace() references public.workspaces (id),
  kind             text not null default 'invoice' check (kind in ('invoice')),
  number           text,                     -- null until issued
  status           text not null default 'draft'
                     check (status in ('draft', 'issued', 'partially_paid', 'paid', 'void')),
  client_id        uuid references public.clients (id) on delete restrict,
  lead_id          uuid references public.leads (id) on delete set null,
  owner_id         uuid references public.profiles (id) on delete set null,
  bill_to_name     text not null default '',
  bill_to_company  text,
  bill_to_email    text,
  bill_to_phone    text,
  bill_to_address  text,
  subject          text,
  issue_date       date not null default public.local_today(),
  due_date         date,
  currency         text not null default 'LKR',
  discount_type    text not null default 'amount',
  discount_value   numeric(14, 2) not null default 0,
  tax_label        text not null default 'VAT',
  tax_rate         numeric(5, 2) not null default 0,
  notes            text,
  terms            text,
  payment_details  text,
  -- Maintained by private.invoice_totals(); anything written here is recomputed.
  subtotal         numeric(14, 2) not null default 0,
  discount_total   numeric(14, 2) not null default 0,
  tax_total        numeric(14, 2) not null default 0,
  total            numeric(14, 2) not null default 0,
  amount_paid      numeric(14, 2) not null default 0,
  balance_due      numeric(14, 2) generated always as (total - amount_paid) stored,
  issued_at        timestamptz,
  paid_at          timestamptz,
  voided_at        timestamptz,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.invoices is
  'Invoices (and, from 0014, quotes). Totals, amount_paid and an issued invoice''s status are derived by triggers.';

alter table public.invoices drop constraint if exists invoices_number_key;
alter table public.invoices add constraint invoices_number_key unique (workspace, kind, number);

alter table public.invoices drop constraint if exists invoices_discount_type_check;
alter table public.invoices
  add constraint invoices_discount_type_check check (discount_type in ('amount', 'percent'));

alter table public.invoices drop constraint if exists invoices_values_check;
alter table public.invoices
  add constraint invoices_values_check check (
    discount_value >= 0
    and tax_rate between 0 and 100
    and currency ~ '^[A-Z]{3}$'
    and amount_paid between 0 and total
  );

-- A client with invoices or quotes keeps them: deleting it is refused (the app
-- offers Archive instead), so billing history never loses its customer.
-- Leads and events just let go (0011).
alter table public.invoices drop constraint if exists invoices_client_id_fkey;
alter table public.invoices add constraint invoices_client_id_fkey
  foreign key (client_id) references public.clients (id) on delete restrict;

create index if not exists invoices_workspace_idx on public.invoices (workspace);
create index if not exists invoices_list_idx on public.invoices (workspace, kind, status, issue_date desc);
create index if not exists invoices_client_idx on public.invoices (client_id);
create index if not exists invoices_lead_idx on public.invoices (lead_id);
create index if not exists invoices_owner_idx on public.invoices (owner_id);
create index if not exists invoices_due_idx on public.invoices (due_date)
  where status in ('issued', 'partially_paid');

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

drop trigger if exists invoices_stamp_created_by on public.invoices;
create trigger invoices_stamp_created_by
  before insert or update on public.invoices
  for each row execute function private.stamp_created_by();

-- Owner defaults to the creator and must be able to open Invoices (0012).
drop trigger if exists invoices_stamp_owner on public.invoices;
create trigger invoices_stamp_owner
  before insert or update of owner_id on public.invoices
  for each row execute function private.stamp_owner('owner_id', 'invoices');

drop trigger if exists invoices_guard_client on public.invoices;
create trigger invoices_guard_client
  before insert or update of client_id, workspace on public.invoices
  for each row execute function private.guard_client_link();

-- Leads are CRM rows an invoices-only member can't read, so unlike the client
-- link this is a definer check: same workspace, nothing more. Foreign keys
-- ignore RLS, so without it a demo invoice could point at a live lead.
create or replace function private.guard_invoice_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lead_id is null
     or (tg_op = 'UPDATE' and new.lead_id is not distinct from old.lead_id
         and new.workspace is not distinct from old.workspace) then
    return new;
  end if;
  if not exists (select 1 from public.leads l where l.id = new.lead_id and l.workspace = new.workspace) then
    raise exception 'That lead doesn''t exist in this workspace.' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_invoice_lead() from public, anon, authenticated;

drop trigger if exists invoices_guard_lead on public.invoices;
create trigger invoices_guard_lead
  before insert or update of lead_id, workspace on public.invoices
  for each row execute function private.guard_invoice_lead();

-- ─────────────────────────────── line items ────────────────────────────────
create table if not exists public.invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  workspace   text not null default public.current_workspace() references public.workspaces (id),
  position    integer not null default 0,
  description text not null,
  details     text,
  quantity    numeric(12, 3) not null default 1,
  unit_price  numeric(14, 2) not null default 0,
  amount      numeric(14, 2) generated always as (round(quantity * unit_price, 2)) stored,
  created_at  timestamptz not null default now()
);

comment on table public.invoice_items is
  'Invoice lines. amount = round(quantity × unit_price, 2); the parent''s totals are derived from these.';

alter table public.invoice_items drop constraint if exists invoice_items_values_check;
alter table public.invoice_items
  add constraint invoice_items_values_check check (
    btrim(description) <> '' and quantity > 0 and unit_price >= 0
  );

create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id, position);
create index if not exists invoice_items_workspace_idx on public.invoice_items (workspace);

-- ─────────────────────────────── payments ──────────────────────────────────
create table if not exists public.invoice_payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  workspace   text not null default public.current_workspace() references public.workspaces (id),
  amount      numeric(14, 2) not null,       -- in the invoice's currency
  amount_base numeric(14, 2) not null,       -- what arrived, in LKR (= amount for LKR invoices)
  paid_on     date not null default public.local_today(),
  method      text,
  reference   text,
  note        text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.invoice_payments is
  'Money received against an invoice. Each row posts one LKR income entry to finance_entries.';

alter table public.invoice_payments drop constraint if exists invoice_payments_amounts_check;
alter table public.invoice_payments
  add constraint invoice_payments_amounts_check check (amount > 0 and amount_base > 0);

create index if not exists invoice_payments_invoice_idx on public.invoice_payments (invoice_id);
create index if not exists invoice_payments_workspace_idx on public.invoice_payments (workspace, paid_on desc);

drop trigger if exists invoice_payments_set_updated_at on public.invoice_payments;
create trigger invoice_payments_set_updated_at
  before update on public.invoice_payments
  for each row execute function public.set_updated_at();

drop trigger if exists invoice_payments_stamp_created_by on public.invoice_payments;
create trigger invoice_payments_stamp_created_by
  before insert or update on public.invoice_payments
  for each row execute function private.stamp_created_by();

-- ───────────────────────────── ledger links ────────────────────────────────
alter table public.finance_entries
  add column if not exists invoice_id uuid references public.invoices (id) on delete set null;
alter table public.finance_entries
  add column if not exists invoice_payment_id uuid unique references public.invoice_payments (id) on delete cascade;

comment on column public.finance_entries.invoice_payment_id is
  'Set on income posted by an invoice payment. Such rows change only through the payment.';

create index if not exists finance_entries_invoice_idx on public.finance_entries (invoice_id);

-- ───────────────────────────── shared helpers ──────────────────────────────
-- `Rs 25,000` / `$ 1,249.50` — the symbols match currencySymbol() in format.ts.
create or replace function private.money(p_amount numeric, p_currency text default 'LKR')
returns text
language sql
immutable
as $$
  select case upper(coalesce(p_currency, 'LKR'))
           when 'LKR' then 'Rs' when 'USD' then '$' when 'EUR' then '€' when 'GBP' then '£'
           when 'AUD' then 'A$' when 'INR' then '₹' when 'SGD' then 'S$'
           else upper(p_currency)
         end
         || ' ' || regexp_replace(to_char(coalesce(p_amount, 0), 'FM999,999,999,990.00'), '\.00$', '');
$$;

-- The ledger line a payment posts: "Payment · INV-0007 · Acme Ltd".
create or replace function private.payment_label(p_number text, p_company text, p_name text)
returns text
language sql
immutable
as $$
  select format('Payment · %s · %s',
    coalesce(p_number, 'Invoice'),
    coalesce(nullif(btrim(p_company), ''), nullif(btrim(p_name), ''), 'Client'));
$$;

revoke execute on function private.money(numeric, text), private.payment_label(text, text, text)
  from public, anon, authenticated;

-- ─────────────────────────────── totals ────────────────────────────────────
-- Runs last among the BEFORE triggers (by name), after the guard has judged
-- what the caller asked for. Definer so the sums never depend on what the
-- caller's RLS can see.
create or replace function private.invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub      numeric(14, 2);
  v_discount numeric(14, 2);
begin
  select coalesce(sum(amount), 0) into v_sub from public.invoice_items where invoice_id = new.id;
  select coalesce(sum(amount), 0) into new.amount_paid from public.invoice_payments where invoice_id = new.id;

  v_discount := case when new.discount_type = 'percent'
                     then round(v_sub * new.discount_value / 100, 2)
                     else new.discount_value end;
  new.subtotal       := v_sub;
  new.discount_total := least(greatest(v_discount, 0), v_sub);
  new.tax_total      := round((v_sub - new.discount_total) * new.tax_rate / 100, 2);
  new.total          := v_sub - new.discount_total + new.tax_total;

  if new.amount_paid > new.total then
    raise exception 'The total can''t drop below the % already paid. Remove a payment first.',
      private.money(new.amount_paid, new.currency)
      using errcode = 'check_violation';
  end if;

  -- An issued invoice's status follows its payments. Nothing to pay = paid.
  if new.kind = 'invoice' and new.status in ('issued', 'partially_paid', 'paid') then
    new.status := case
      when new.amount_paid >= new.total then 'paid'
      when new.amount_paid > 0 then 'partially_paid'
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

drop trigger if exists invoices_totals on public.invoices;
create trigger invoices_totals
  before insert or update on public.invoices
  for each row execute function private.invoice_totals();

-- ──────────────────────────────── guard ────────────────────────────────────
-- What the API may do to an invoice. Issuing goes through issue_document,
-- paid / part paid follow the payments, and the only status the API sets on an
-- invoice is void. 0014 adds the quote rules, 0015 the schedule columns.
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
        case when old.kind = 'invoice' then 'void an issued invoice instead' else 'decline or expire it instead' end
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

  -- The stamps are the database's: issued by issue_document, paid and voided
  -- by the totals trigger (trusted paths may backdate them, the API can't).
  new.issued_at := old.issued_at;
  new.paid_at := old.paid_at;
  new.voided_at := old.voided_at;

  if new.kind is distinct from old.kind then
    raise exception 'An invoice can''t become a quote, or a quote an invoice.' using errcode = 'check_violation';
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
        if old.status not in ('issued', 'partially_paid', 'paid') then
          raise exception 'Only an issued invoice can be voided — delete a draft instead.'
            using errcode = 'check_violation';
        end if;
        if old.amount_paid > 0 then
          raise exception 'Remove its payments before voiding it.' using errcode = 'check_violation';
        end if;
      elsif new.status = 'draft' then
        raise exception 'An issued invoice can''t go back to draft.' using errcode = 'check_violation';
      elsif old.status = 'draft' then
        raise exception 'Use Issue to number and send it.' using errcode = 'check_violation';
      else
        raise exception 'Paid and part paid follow the payments — record or remove a payment instead.'
          using errcode = 'check_violation';
      end if;
    end if;

    if old.amount_paid > 0 then
      if new.currency is distinct from old.currency then
        raise exception 'The currency is locked once a payment is recorded.' using errcode = 'check_violation';
      end if;
      if new.client_id is distinct from old.client_id then
        raise exception 'The client is locked once a payment is recorded.' using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function private.guard_invoices() from public, anon, authenticated;

drop trigger if exists invoices_guard on public.invoices;
create trigger invoices_guard
  before insert or update or delete on public.invoices
  for each row execute function private.guard_invoices();

-- ─────────────────────────── item triggers ─────────────────────────────────
-- Child rows live in their parent's workspace (definer: the fence then judges
-- the result, so a demo caller can't hang a line off a live invoice).
create or replace function private.invoice_child_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
    raise exception 'A line can''t move to another invoice.' using errcode = 'check_violation';
  end if;
  new.workspace := (select i.workspace from public.invoices i where i.id = new.invoice_id);
  if new.workspace is null then
    raise exception 'That invoice doesn''t exist.' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.invoice_child_workspace() from public, anon, authenticated;

drop trigger if exists invoice_items_workspace on public.invoice_items;
create trigger invoice_items_workspace
  before insert or update on public.invoice_items
  for each row execute function private.invoice_child_workspace();

-- Touch the parent so its totals recompute. Invoker on purpose: an API edit
-- reaches the invoice as the caller, so the guard above still applies (no
-- lines added to a void invoice, no total below what's been paid). Batched
-- writers (save_invoice, conversions, recurring runs) set
-- flowstate.invoice_batch and touch the parent once themselves.
create or replace function private.touch_invoice_from_item()
returns trigger
language plpgsql
security invoker
as $$
begin
  if coalesce(current_setting('flowstate.invoice_batch', true), '') = 'on' then
    return null;
  end if;
  update public.invoices set updated_at = now() where id = coalesce(new.invoice_id, old.invoice_id);
  return null;
end;
$$;

revoke execute on function private.touch_invoice_from_item() from public, anon, authenticated;

drop trigger if exists invoice_items_touch_invoice on public.invoice_items;
create trigger invoice_items_touch_invoice
  after insert or update or delete on public.invoice_items
  for each row execute function private.touch_invoice_from_item();

-- ────────────────────────── payment triggers ───────────────────────────────
-- Read as the caller first (runs before the check below, by name): the
-- definer check would otherwise answer with the balance of an invoice the
-- caller can't see.
create or replace function private.guard_payment_access()
returns trigger
language plpgsql
security invoker
as $$
begin
  if current_user in ('authenticated', 'anon')
     and not exists (select 1 from public.invoices i where i.id = new.invoice_id) then
    raise exception 'That invoice isn''t available.' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_payment_access() from public, anon, authenticated;

drop trigger if exists invoice_payments_access on public.invoice_payments;
create trigger invoice_payments_access
  before insert or update on public.invoice_payments
  for each row execute function private.guard_payment_access();

-- Locks the invoice first, so two people recording the last payment at once
-- can't both squeeze under the balance.
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

drop trigger if exists invoice_payments_check on public.invoice_payments;
create trigger invoice_payments_check
  before insert or update on public.invoice_payments
  for each row execute function private.check_invoice_payment();

-- Ledger, parent touch, alerts and the audit line for one payment. The income
-- row goes with the payment (on delete cascade), so a delete only touches.
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
begin
  select * into inv from public.invoices where id = pay.invoice_id;
  if not found then
    -- The invoice itself is being deleted (trusted cleanup): nothing to keep in step.
    return null;
  end if;

  if tg_op <> 'DELETE' then
    insert into public.finance_entries
      (workspace, kind, entry_date, description, category, amount, currency, method, reference,
       lead_id, invoice_id, invoice_payment_id, created_by)
    values
      (inv.workspace, 'income', new.paid_on,
       private.payment_label(inv.number, inv.bill_to_company, inv.bill_to_name),
       'Client project', new.amount_base, 'LKR', new.method, inv.number,
       inv.lead_id, inv.id, new.id, new.created_by)
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

  select coalesce(sum(p.amount), 0) into paid from public.invoice_payments p where p.invoice_id = inv.id;
  billed := coalesce(nullif(btrim(inv.bill_to_company), ''), nullif(btrim(inv.bill_to_name), ''));

  if tg_op = 'INSERT' then
    perform private.notify(
      array(
        select u from private.users_with_access('invoices', inv.workspace) u where u = inv.owner_id
        union
        select private.admins_of(inv.workspace)
      ),
      inv.workspace,
      case when paid >= inv.total then 'invoice_paid' else 'payment_recorded' end,
      case when paid >= inv.total
           then format('%s paid in full', coalesce(inv.number, 'Invoice'))
           else format('Payment received · %s', coalesce(inv.number, 'invoice')) end,
      concat_ws(' · ',
        billed,
        private.money(new.amount, inv.currency) || ' received',
        case when paid < inv.total then private.money(inv.total - paid, inv.currency) || ' left to pay' end
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

drop trigger if exists invoice_payments_post on public.invoice_payments;
create trigger invoice_payments_post
  after insert or update or delete on public.invoice_payments
  for each row execute function private.post_invoice_payment();

-- ───────────────────────── ledger stays in step ─────────────────────────────
-- A renumbered invoice or a new bill-to rewrites its income lines. Plain
-- AFTER UPDATE (no column list): derived changes come from BEFORE triggers,
-- which UPDATE OF … can't see.
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
  set description = private.payment_label(new.number, new.bill_to_company, new.bill_to_name),
      reference   = new.number,
      lead_id     = new.lead_id
  where f.invoice_id = new.id and f.invoice_payment_id is not null;
  return null;
end;
$$;

revoke execute on function private.sync_invoice_ledger() from public, anon, authenticated;

drop trigger if exists invoices_sync_ledger on public.invoices;
create trigger invoices_sync_ledger
  after update on public.invoices
  for each row execute function private.sync_invoice_ledger();

-- Income posted by a payment is owned by the payment. Invoker: trusted paths
-- (the triggers above, foreign-key cascades, which run as the table owner)
-- pass; API callers are stopped.
create or replace function private.guard_invoice_income()
returns trigger
language plpgsql
security invoker
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op <> 'INSERT' and old.invoice_payment_id is not null then
    raise exception 'This income belongs to % — change it from Invoices.', coalesce(old.reference, 'an invoice')
      using errcode = 'check_violation';
  end if;
  if tg_op <> 'DELETE' and new.invoice_payment_id is not null then
    raise exception 'Invoice payments post their own income — record the payment in Invoices.'
      using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function private.guard_invoice_income() from public, anon, authenticated;

drop trigger if exists finance_entries_guard_invoice on public.finance_entries;
create trigger finance_entries_guard_invoice
  before insert or update or delete on public.finance_entries
  for each row execute function private.guard_invoice_income();

-- ─────────────────────────── overdue alerts ────────────────────────────────
-- An open invoice with a due date carries one scheduled `invoice_overdue`
-- alert for its owner, delivered 09:00 Colombo the day after it falls due
-- (RLS hides it until then). Paid, voided or deleted → cleared; a new due
-- date or owner → rescheduled. Partial payments leave it alone. No actor: the
-- system raises it, so it reaches the owner even if they issued the invoice.
create or replace function private.schedule_invoice_overdue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_open  boolean;
  was_open boolean := false;
begin
  if tg_op = 'DELETE' then
    perform private.clear_pending('invoice', old.id);
    return null;
  end if;

  is_open := new.kind = 'invoice' and new.status in ('issued', 'partially_paid') and new.due_date is not null;
  if tg_op = 'UPDATE' then
    was_open := old.kind = 'invoice' and old.status in ('issued', 'partially_paid') and old.due_date is not null;
    if is_open = was_open
       and new.due_date is not distinct from old.due_date
       and new.owner_id is not distinct from old.owner_id then
      return null;
    end if;
  end if;
  if not is_open and not was_open then
    return null;
  end if;

  perform private.clear_pending('invoice', new.id, array['invoice_overdue']);
  if is_open then
    perform private.notify(
      array(select u from private.users_with_access('invoices', new.workspace) u where u = new.owner_id),
      new.workspace,
      'invoice_overdue',
      format('%s is overdue', coalesce(new.number, 'An invoice')),
      concat_ws(' · ',
        coalesce(nullif(btrim(new.bill_to_company), ''), nullif(btrim(new.bill_to_name), '')),
        'was due ' || to_char(new.due_date, 'FMDD Mon YYYY')
      ),
      '/admin/invoices/' || new.id,
      'invoice', new.id,
      private.local_at(new.due_date + 1, '09:00'),
      null
    );
  end if;
  return null;
end;
$$;

revoke execute on function private.schedule_invoice_overdue() from public, anon, authenticated;

drop trigger if exists invoices_overdue on public.invoices;
create trigger invoices_overdue
  after insert or update or delete on public.invoices
  for each row execute function private.schedule_invoice_overdue();

-- ───────────────────────────── activity log ────────────────────────────────
drop trigger if exists invoices_activity on public.invoices;
create trigger invoices_activity
  after insert or update or delete on public.invoices
  for each row execute function private.log_activity(
    'invoice', 'number', '{subtotal,discount_total,tax_total,total,amount_paid,balance_due,paid_at}'
  );

-- ───────────────────────────── policies ────────────────────────────────────
alter table public.invoices         enable row level security;
alter table public.invoice_items    enable row level security;
alter table public.invoice_payments enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['invoices', 'invoice_items', 'invoice_payments'] loop
    execute format('drop policy if exists "workspace fence" on public.%I', t);
    execute format(
      'create policy "workspace fence" on public.%I as restrictive for all to authenticated
         using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
         with check (workspace = (select public.current_workspace()) and (select public.is_active_member()))',
      t
    );
  end loop;
end $$;

drop policy if exists "invoices: module" on public.invoices;
create policy "invoices: module"
  on public.invoices for all to authenticated
  using ((select public.can_access('invoices')))
  with check ((select public.can_access('invoices')));

-- Children follow the parent as the caller sees it.
drop policy if exists "invoice items: module" on public.invoice_items;
create policy "invoice items: module"
  on public.invoice_items for all to authenticated
  using ((select public.can_access('invoices'))
         and exists (select 1 from public.invoices i where i.id = invoice_id))
  with check ((select public.can_access('invoices'))
              and exists (select 1 from public.invoices i where i.id = invoice_id));

drop policy if exists "invoice payments: module" on public.invoice_payments;
create policy "invoice payments: module"
  on public.invoice_payments for all to authenticated
  using ((select public.can_access('invoices'))
         and exists (select 1 from public.invoices i where i.id = invoice_id))
  with check ((select public.can_access('invoices'))
              and exists (select 1 from public.invoices i where i.id = invoice_id));

revoke all on public.invoices, public.invoice_items, public.invoice_payments from anon;

-- ─────────────────────────── document numbers ──────────────────────────────
-- Next free number for a kind, under a lock on the settings row. Numbers typed
-- in by a trusted path (import, seed) are skipped, never reused.
create or replace function private.allocate_number(p_workspace text, p_kind text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg    public.invoice_settings;
  prefix text;
  n      integer;
  v      text;
begin
  insert into public.invoice_settings (workspace) values (p_workspace) on conflict do nothing;
  select * into cfg from public.invoice_settings where workspace = p_workspace for update;

  prefix := btrim(case when p_kind = 'quote' then cfg.quote_prefix else cfg.invoice_prefix end);
  n := case when p_kind = 'quote' then cfg.next_quote_number else cfg.next_invoice_number end;
  loop
    v := prefix || '-' || lpad(n::text, greatest(4, length(n::text)), '0');
    exit when not exists (
      select 1 from public.invoices where workspace = p_workspace and kind = p_kind and number = v
    );
    n := n + 1;
  end loop;

  if p_kind = 'quote' then
    update public.invoice_settings set next_quote_number = n + 1 where workspace = p_workspace;
  else
    update public.invoice_settings set next_invoice_number = n + 1 where workspace = p_workspace;
  end if;
  return v;
end;
$$;

-- Number a draft and send it out: invoices become issued (paid if there's
-- nothing to pay), quotes become sent. No access checks — callers check.
-- decide_approval (0016) uses this to issue an invoice it approves, so a
-- pending_approval invoice is accepted too.
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
  set number    = coalesce(doc.number, private.allocate_number(doc.workspace, doc.kind)),
      status    = case when doc.kind = 'quote' then 'sent' else 'issued' end,
      issued_at = coalesce(doc.issued_at, now())
  where id = p_id
  returning * into doc;

  return jsonb_build_object('status', doc.status, 'number', doc.number);
end;
$$;

revoke execute on function private.allocate_number(text, text), private.issue_invoice(uuid)
  from public, anon, authenticated;

-- ─────────────────────────────── RPCs ──────────────────────────────────────
-- Save the editor in one call: header + the full list of lines, recomputed
-- once. Invoker, so RLS and every guard apply. Only whitelisted keys are
-- read; `kind` counts on create only and `id` picks the row to update.
-- p_items null leaves the lines alone.
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
    'payment_details'
  ];
  v_id   uuid := nullif(p_invoice ->> 'id', '')::uuid;
  v_kind text := coalesce(nullif(p_invoice ->> 'kind', ''), 'invoice');
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

  -- The whitelisted keys that were sent, limited to columns this schema has
  -- (valid_until arrives with 0014). Names come from the catalog, never the payload.
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

  if v_id is null then
    if v_kind not in ('invoice', 'quote') then
      raise exception 'Unknown document type.' using errcode = '22023';
    end if;
    execute format(
      'insert into public.invoices (kind%s) select $2%s from jsonb_populate_record(null::public.invoices, $1) r returning id',
      coalesce(', ' || v_cols, ''), coalesce(', ' || v_vals, '')
    ) into v_id using p_invoice, v_kind;
    -- The insert wrote the header (and its triggers filled the defaults); the
    -- update below only recomputes, so it mustn't write the payload again.
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

  -- One write to the header after the lines: the edits and the recompute together.
  execute format(
    'update public.invoices i set %s from jsonb_populate_record(null::public.invoices, $1) r where i.id = $2',
    concat_ws(', ', v_set, 'updated_at = now()')
  ) using p_invoice, v_id;

  return v_id;
end;
$$;

-- Number a draft: invoice → issued (or paid when there's nothing to pay),
-- quote → sent. Definer so the counter can be locked and bumped; it checks
-- access and workspace itself. 0016 adds the approval branch. An invoice
-- waiting for approval is issued by the approver's decision, never from here.
create or replace function public.issue_document(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.can_access('invoices') then
    raise exception 'You don''t have access to Invoices.' using errcode = '42501';
  end if;
  select status into v_status from public.invoices
  where id = p_id and workspace = public.current_workspace()
  for update;
  if not found then
    raise exception 'That document isn''t available.' using errcode = 'P0002';
  end if;
  if v_status = 'pending_approval' then
    raise exception 'This invoice is waiting for approval — an admin approves or rejects it.'
      using errcode = 'check_violation';
  end if;
  return private.issue_invoice(p_id);
end;
$$;

-- Headline numbers for the Issued tab. Money in the default currency only
-- (other currencies are listed, not converted); Received is the LKR that
-- arrived, so it reconciles with Income. Outstanding and overdue are as of
-- today, whatever the period.
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
    select i.currency, i.total, i.balance_due, i.due_date,
           (p_from is null or i.issue_date >= p_from) and (p_to is null or i.issue_date <= p_to) as in_period,
           i.status in ('issued', 'partially_paid') as open
    from public.invoices i
    where i.workspace = public.current_workspace()
      and i.kind = 'invoice'
      and i.status in ('issued', 'partially_paid', 'paid')
  )
  select jsonb_build_object(
    'issued_total',      coalesce(sum(d.total) filter (where d.in_period and d.currency = cfg.currency), 0),
    'issued_count',      count(*) filter (where d.in_period and d.currency = cfg.currency),
    'received_total',    (select coalesce(sum(p.amount_base), 0)
                          from public.invoice_payments p
                          where p.workspace = public.current_workspace()
                            and (p_from is null or p.paid_on >= p_from)
                            and (p_to is null or p.paid_on <= p_to)),
    'outstanding_total', coalesce(sum(d.balance_due) filter (where d.open and d.currency = cfg.currency), 0),
    'outstanding_count', count(*) filter (where d.open and d.currency = cfg.currency),
    'overdue_total',     coalesce(sum(d.balance_due) filter (
                           where d.open and d.currency = cfg.currency and d.due_date < public.local_today()), 0),
    'overdue_count',     count(*) filter (
                           where d.open and d.currency = cfg.currency and d.due_date < public.local_today()),
    'currency',          cfg.currency,
    'other_currencies',  coalesce(
                           array_agg(distinct d.currency) filter (
                             where d.currency <> cfg.currency and (d.in_period or d.open)),
                           '{}'::text[])
  )
  from cfg
  left join docs d on true
  group by cfg.currency;
$$;

revoke execute on function public.save_invoice(jsonb, jsonb), public.issue_document(uuid),
  public.invoice_kpis(date, date)
  from public, anon, authenticated;
grant execute on function public.save_invoice(jsonb, jsonb), public.issue_document(uuid),
  public.invoice_kpis(date, date)
  to authenticated, service_role;
