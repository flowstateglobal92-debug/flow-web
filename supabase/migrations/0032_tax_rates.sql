-- ============================================================================
-- 0032 · Taxes
-- Named tax rates (VAT 18%, SSCL 2.5% …) that each line of a document can
-- carry, prices that include tax, a tax report, and what a Sri Lankan tax
-- invoice must show (supplier and buyer TIN, date of supply).
--
--   tax_rates — the workspace's rates. "Compound" ones are charged on the
--     line plus its other taxes (VAT on the amount including SSCL, if that's
--     how your accountant wants it). "Default" ones go on new lines. Admins
--     manage them; anyone with Invoices, Reports or Expenses reads them.
--   invoice_items.taxes — the rates on a line, copied when it's saved
--     ([{id, name, rate, compound}]), so changing a rate later never changes
--     an issued document.
--   invoices.tax_breakdown — the document's taxes, worked out by the totals
--     trigger: [{name, rate, compound, base, amount}], in the order they
--     first appear.
--
-- The maths (private.invoice_totals; the browser's exact copy is
-- computeTotals in src/lib/admin/invoice-math.ts):
--   line     = round(qty × rate, 2);  subtotal = Σ line;  discount as before
--   K        = (subtotal − discount) / subtotal — the discount spread over the
--              lines in proportion
--   each tax = round(Σ its lines' base × rate / 100, 2), where a line's base
--              is line × K (+ the line's other taxes for a compound rate);
--              with prices_include_tax the line's tax is taken back out first
--   total    = subtotal − discount + Σ taxes   (incl. prices: subtotal − discount)
-- Every division is done once, on exact numerators, so a figure that lands on
-- half a cent rounds the same way here and in the browser.
--
-- A document whose lines carry no taxes keeps 0013's single tax_label/tax_rate
-- (existing documents are never recomputed differently).
-- Requires: 0031. Idempotent.
-- ============================================================================

-- ─────────────────────────────── tax rates ─────────────────────────────────
create table if not exists public.tax_rates (
  id          uuid primary key default gen_random_uuid(),
  workspace   text not null default public.current_workspace() references public.workspaces (id),
  name        text not null,
  rate        numeric(6, 3) not null,
  compound    boolean not null default false,
  is_default  boolean not null default false,
  active      boolean not null default true,
  position    integer not null default 0,
  note        text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.tax_rates is
  'Named tax rates a document line can carry (0032). Lines keep a copy, so editing a rate never changes issued documents.';

alter table public.tax_rates drop constraint if exists tax_rates_values_check;
alter table public.tax_rates
  add constraint tax_rates_values_check check (
    btrim(name) <> '' and char_length(name) <= 40 and rate between 0 and 100
    and (note is null or char_length(note) <= 300)
  );

create unique index if not exists tax_rates_name_rate_key
  on public.tax_rates (workspace, lower(btrim(name)), rate, compound);
create index if not exists tax_rates_workspace_idx on public.tax_rates (workspace, position);

drop trigger if exists tax_rates_set_updated_at on public.tax_rates;
create trigger tax_rates_set_updated_at
  before update on public.tax_rates
  for each row execute function public.set_updated_at();

drop trigger if exists tax_rates_stamp on public.tax_rates;
create trigger tax_rates_stamp
  before insert on public.tax_rates
  for each row execute function private.stamp_created_by();

drop trigger if exists tax_rates_activity on public.tax_rates;
create trigger tax_rates_activity
  after insert or update or delete on public.tax_rates
  for each row execute function private.log_activity('tax rate', 'name', '');

alter table public.tax_rates enable row level security;

drop policy if exists "workspace fence" on public.tax_rates;
create policy "workspace fence" on public.tax_rates as restrictive for all to authenticated
  using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
  with check (workspace = (select public.current_workspace()) and (select public.is_active_member()));

drop policy if exists "tax rates: read" on public.tax_rates;
create policy "tax rates: read"
  on public.tax_rates for select to authenticated
  using ((select public.can_access('invoices')) or (select public.can_access('reports'))
         or (select public.can_access('finance')));

drop policy if exists "tax rates: admins write" on public.tax_rates;
create policy "tax rates: admins write"
  on public.tax_rates for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on public.tax_rates from anon;

-- ───────────────────────────── new columns ─────────────────────────────────
alter table public.invoice_settings add column if not exists tax_registered boolean not null default false;
alter table public.invoice_settings add column if not exists prices_include_tax boolean not null default false;

comment on column public.invoice_settings.tax_registered is
  'VAT-registered: documents with tax print as TAX INVOICE with both TINs and the rupee breakdown.';
comment on column public.invoice_settings.prices_include_tax is
  'Default for new documents: line rates already include their taxes.';

alter table public.invoices add column if not exists prices_include_tax boolean not null default false;
alter table public.invoices add column if not exists tax_breakdown jsonb not null default '[]'::jsonb;
alter table public.invoices add column if not exists supply_date date;
alter table public.invoices add column if not exists bill_to_tax_id text;

comment on column public.invoices.tax_breakdown is
  'Worked out by private.invoice_totals: [{name, rate, compound, base, amount}].';
comment on column public.invoices.supply_date is 'Date of supply, when it differs from the issue date (tax invoices).';
comment on column public.invoices.bill_to_tax_id is 'The buyer''s TIN / VAT number, printed on tax invoices.';

alter table public.invoice_items add column if not exists taxes jsonb not null default '[]'::jsonb;

comment on column public.invoice_items.taxes is
  'The rates on this line, copied when saved: [{id, name, rate, compound}] (0032).';

alter table public.invoice_items drop constraint if exists invoice_items_taxes_check;
alter table public.invoice_items
  add constraint invoice_items_taxes_check check (jsonb_typeof(taxes) = 'array' and jsonb_array_length(taxes) <= 4);

alter table public.invoices drop constraint if exists invoices_tax_fields_check;
alter table public.invoices
  add constraint invoices_tax_fields_check check (
    jsonb_typeof(tax_breakdown) = 'array'
    and (bill_to_tax_id is null or char_length(bill_to_tax_id) <= 40)
  );

-- ─────────────────────────── line tax helper ───────────────────────────────
-- A line's taxes as sent by an editor, cleaned: objects with a name and a rate
-- from 0 to 100 (three decimals), compound or not, an id only if it's a uuid;
-- the same tax twice is kept once; four at most. Anything else is refused.
create or replace function private.clean_item_taxes(p_taxes jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  e      jsonb;
  out_   jsonb := '[]'::jsonb;
  v_name text;
  v_rate numeric;
  v_cmp  boolean;
  v_id   text;
begin
  if p_taxes is null or jsonb_typeof(p_taxes) = 'null' then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_taxes) <> 'array' then
    raise exception 'A line''s taxes must be a list.' using errcode = '22023';
  end if;
  for e in select x from jsonb_array_elements(p_taxes) as t(x) loop
    if jsonb_typeof(e) <> 'object' then
      raise exception 'Each tax needs a name and a rate.' using errcode = '22023';
    end if;
    v_name := left(btrim(coalesce(e ->> 'name', '')), 40);
    if v_name = '' then
      raise exception 'Each tax needs a name.' using errcode = 'check_violation';
    end if;
    if coalesce(e ->> 'rate', '') !~ '^\s*[0-9]{1,3}(\.[0-9]+)?\s*$' then
      raise exception 'Tax rates must be between 0 and 100%%.' using errcode = 'check_violation';
    end if;
    v_rate := round((e ->> 'rate')::numeric, 3);
    if v_rate < 0 or v_rate > 100 then
      raise exception 'Tax rates must be between 0 and 100%%.' using errcode = 'check_violation';
    end if;
    v_cmp := coalesce((e ->> 'compound')::boolean, false);
    v_id := case when coalesce(e ->> 'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 then lower(e ->> 'id') end;
    continue when exists (
      select 1 from jsonb_array_elements(out_) o(x)
      where lower(o.x ->> 'name') = lower(v_name) and (o.x ->> 'rate')::numeric = v_rate
        and (o.x ->> 'compound')::boolean = v_cmp
    );
    if jsonb_array_length(out_) >= 4 then
      raise exception 'A line can carry four taxes at most.' using errcode = 'check_violation';
    end if;
    out_ := out_ || jsonb_build_array(jsonb_build_object('id', v_id, 'name', v_name, 'rate', v_rate, 'compound', v_cmp));
  end loop;
  return out_;
end;
$$;

revoke execute on function private.clean_item_taxes(jsonb) from public, anon, authenticated;

-- Every write of a line goes through it — save_invoice, a conversion, a
-- schedule, an upload from the desktop — so no path can store a bad tax.
-- Definer: API callers can't reach private.* themselves.
create or replace function private.invoice_item_taxes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.taxes := private.clean_item_taxes(new.taxes);
  return new;
end;
$$;

revoke execute on function private.invoice_item_taxes() from public, anon, authenticated;

drop trigger if exists invoice_items_taxes on public.invoice_items;
create trigger invoice_items_taxes
  before insert or update on public.invoice_items
  for each row execute function private.invoice_item_taxes();

-- ─────────────────────────────── totals ────────────────────────────────────
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
  g          record;
begin
  select coalesce(sum(i.amount), 0), count(*) filter (where jsonb_array_length(i.taxes) > 0)
  into v_sub, v_taxed
  from public.invoice_items i where i.invoice_id = new.id;
  select coalesce(sum(amount), 0) into new.amount_paid from public.invoice_payments where invoice_id = new.id;

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
               -- prices before tax: base = excl × K / 100 (a compound rate's
               -- base takes in the line's other taxes)
               sum(case when s.compound then s.amt * (100 + s.r_nc) else s.amt * 100 end) as excl,
               -- prices with tax in them: base = incl × K, each line's tax
               -- taken back out first
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

-- The breakdown is derived, like the totals: not worth an audit line.
drop trigger if exists invoices_activity on public.invoices;
create trigger invoices_activity
  after insert or update or delete on public.invoices
  for each row execute function private.log_activity(
    'invoice', 'number', '{subtotal,discount_total,tax_total,total,amount_paid,balance_due,paid_at,tax_breakdown}'
  );

-- ───────────────────────────── save_invoice ────────────────────────────────
-- 0031's function: prices_include_tax, supply_date and bill_to_tax_id are
-- editable, and each line may carry taxes (cleaned by invoice_items_taxes).
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
    'payment_details', 'exchange_rate', 'prices_include_tax', 'supply_date', 'bill_to_tax_id'
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


-- ─────────────────────────── quote → invoice ───────────────────────────────
-- 0014's conversion; the rate, the tax settings and each line's taxes come along.
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
  v_owner := case
    when q.owner_id is not null and (q.owner_id = auth.uid() or public.user_can_access(q.owner_id, 'invoices'))
      then q.owner_id
    else auth.uid()
  end;

  perform set_config('flowstate.invoice_batch', 'on', true);

  insert into public.invoices (
    kind, client_id, lead_id, owner_id, bill_to_name, bill_to_company, bill_to_email, bill_to_phone,
    bill_to_address, bill_to_tax_id, subject, issue_date, due_date, currency, exchange_rate,
    discount_type, discount_value, tax_label, tax_rate, prices_include_tax,
    notes, terms, payment_details, source_quote_id
  ) values (
    'invoice', q.client_id, q.lead_id, v_owner, q.bill_to_name, q.bill_to_company, q.bill_to_email, q.bill_to_phone,
    q.bill_to_address, q.bill_to_tax_id, q.subject, public.local_today(), public.local_today() + coalesce(days, 14),
    q.currency, q.exchange_rate,
    q.discount_type, q.discount_value, q.tax_label, q.tax_rate, q.prices_include_tax,
    q.notes, q.terms, q.payment_details, q.id
  )
  returning id into v_id;

  insert into public.invoice_items (invoice_id, position, description, details, quantity, unit_price, taxes)
  select v_id, i.position, i.description, i.details, i.quantity, i.unit_price, i.taxes
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

-- ─────────────────────────── recurring invoices ────────────────────────────
-- 0015's generator; the template's tax settings, buyer TIN, rate and each
-- line's taxes come along.
create or replace function private.generate_scheduled_invoice(s public.invoice_schedules, p_period date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t       public.invoices := jsonb_populate_record(null::public.invoices, s.template);
  cfg     public.invoice_settings;
  v_owner uuid;
  v_id    uuid;
  issued  jsonb;
  doc     public.invoices;
  prev    text := coalesce(current_setting('flowstate.invoice_batch', true), '');
begin
  select * into cfg from public.invoice_settings where workspace = s.workspace;
  select p.id into v_owner from public.profiles p
  where p.id = coalesce(s.owner_id, t.owner_id, s.created_by) and p.workspace = s.workspace;

  perform set_config('flowstate.invoice_batch', 'on', true);

  insert into public.invoices (
    workspace, kind, status, schedule_id, period_start, client_id, lead_id, owner_id,
    bill_to_name, bill_to_company, bill_to_email, bill_to_phone, bill_to_address, bill_to_tax_id, subject,
    issue_date, due_date, currency, exchange_rate, discount_type, discount_value, tax_label, tax_rate,
    prices_include_tax, notes, terms, payment_details, created_by
  ) values (
    s.workspace, 'invoice', 'draft', s.id, p_period, s.client_id,
    (select l.id from public.leads l where l.id = t.lead_id and l.workspace = s.workspace),
    v_owner,
    coalesce(t.bill_to_name, ''), t.bill_to_company, t.bill_to_email, t.bill_to_phone, t.bill_to_address,
    t.bill_to_tax_id, t.subject,
    p_period, p_period + coalesce(cfg.default_due_days, 14),
    coalesce(nullif(s.currency, ''), t.currency, 'LKR'), t.exchange_rate,
    coalesce(t.discount_type, 'amount'), coalesce(t.discount_value, 0),
    coalesce(t.tax_label, cfg.tax_label, 'VAT'), coalesce(t.tax_rate, 0),
    coalesce(t.prices_include_tax, cfg.prices_include_tax, false),
    coalesce(t.notes, cfg.default_notes), coalesce(t.terms, cfg.default_terms),
    coalesce(t.payment_details, cfg.payment_details),
    s.created_by
  )
  returning id into v_id;

  insert into public.invoice_items (invoice_id, position, description, details, quantity, unit_price, taxes)
  select v_id, (e.ord - 1)::integer, btrim(e.item ->> 'description'), nullif(btrim(e.item ->> 'details'), ''),
         coalesce((e.item ->> 'quantity')::numeric, 1), coalesce((e.item ->> 'unit_price')::numeric, 0),
         coalesce(e.item -> 'taxes', '[]'::jsonb)
  from jsonb_array_elements(coalesce(s.template -> 'items', '[]'::jsonb)) with ordinality as e(item, ord);

  perform set_config('flowstate.invoice_batch', prev, true);
  update public.invoices set updated_at = now() where id = v_id;

  if s.auto_issue then
    issued := private.issue_invoice(v_id);
  end if;

  select * into doc from public.invoices where id = v_id;
  perform private.notify(
    array(select u from private.users_with_access('invoices', s.workspace) u where u = doc.owner_id),
    s.workspace,
    'recurring_generated',
    case when issued is not null
         then format('%s issued · %s', doc.number, s.name)
         else format('Draft ready to review · %s', s.name) end,
    concat_ws(' · ',
      coalesce(nullif(btrim(doc.bill_to_company), ''), nullif(btrim(doc.bill_to_name), '')),
      private.money(doc.total, doc.currency),
      'for ' || to_char(p_period, 'FMDD Mon YYYY')
    ),
    '/admin/invoices/' || v_id,
    'invoice', v_id,
    now(),
    null
  );
  return v_id;
end;
$$;

revoke execute on function private.generate_scheduled_invoice(public.invoice_schedules, date)
  from public, anon, authenticated;

-- ──────────────────────────────── tax report ───────────────────────────────
-- Output tax on documents issued between two days, in rupees (foreign ones at
-- their rate; without a rate they're listed apart), by tax and rate, with the
-- documents behind it. Credit notes (0033) and bills (0040) join in later.
-- Definer like the other reports, so it checks Reports access itself.
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
             coalesce(c.name, nullif(btrim(i.bill_to_company), ''), nullif(btrim(i.bill_to_name), '')) as client,
             i.bill_to_tax_id,
             private.base_amount(i.total, i.currency, i.exchange_rate) as total_lkr,
             private.base_amount(i.tax_total, i.currency, i.exchange_rate) as tax_lkr,
             private.base_amount(i.total - i.tax_total, i.currency, i.exchange_rate) as net_lkr
      from public.invoices i
      left join public.clients c on c.id = i.client_id and c.workspace = i.workspace
      where i.workspace = ws
        and i.kind = 'invoice'
        and i.status in ('issued', 'partially_paid', 'paid')
        and i.issue_date between p_from and p_to
    ),
    lines as (
      select (b.x ->> 'name') as name, (b.x ->> 'rate')::numeric as rate,
             coalesce((b.x ->> 'compound')::boolean, false) as compound,
             private.base_amount((b.x ->> 'base')::numeric, d.currency, d.exchange_rate) as base_lkr,
             private.base_amount((b.x ->> 'amount')::numeric, d.currency, d.exchange_rate) as amount_lkr
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
      'sales_net', coalesce((select sum(net_lkr) from docs where total_lkr is not null), 0),
      'sales_total', coalesce((select sum(total_lkr) from docs where total_lkr is not null), 0),
      'untaxed_total', coalesce((select sum(total_lkr) from docs
                                 where total_lkr is not null and jsonb_array_length(tax_breakdown) = 0), 0),
      'unconverted', coalesce((
        select jsonb_agg(jsonb_build_object('id', d.id, 'number', d.number, 'currency', d.currency))
        from docs d where d.total_lkr is null
      ), '[]'::jsonb),
      'documents', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', d.id, 'number', d.number, 'kind', d.kind, 'issue_date', d.issue_date,
                 'client', d.client, 'tax_id', d.bill_to_tax_id, 'currency', d.currency,
                 'net', d.net_lkr, 'tax', d.tax_lkr, 'total', d.total_lkr)
               order by d.issue_date, d.number)
        from (select * from docs where total_lkr is not null order by issue_date, number limit 1000) d
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke execute on function public.report_tax(date, date) from public, anon, authenticated;
grant execute on function public.report_tax(date, date) to authenticated, service_role;

-- ───────────────────────────── existing rates ──────────────────────────────
-- A workspace that already charges a default tax gets it as a named rate
-- (default on), so new lines keep charging it. Existing documents keep their
-- single rate and are never recomputed differently.
insert into public.tax_rates (workspace, name, rate, is_default)
select s.workspace, coalesce(nullif(btrim(s.tax_label), ''), 'VAT'), s.default_tax_rate, true
from public.invoice_settings s
where s.default_tax_rate > 0
  and not exists (select 1 from public.tax_rates r where r.workspace = s.workspace)
on conflict do nothing;

-- ───────────────────────────── desktop sync ────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'powersync')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'powersync' and schemaname = 'public' and tablename = 'tax_rates') then
    alter publication powersync add table public.tax_rates;
  end if;
end;
$$;
