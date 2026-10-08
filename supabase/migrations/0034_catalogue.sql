-- ============================================================================
-- 0034 · Products & services catalogue
-- Saved line items for quotes and invoices: a name (the line's description),
-- default details, unit, rate, the taxes a line gets, and optional prices in
-- other currencies ({"USD": 120}). Picking one in the editor fills the line;
-- the line keeps its own copy, so editing the catalogue never changes a
-- document. Everyone with Invoices uses and keeps it.
-- Requires: 0033. Idempotent.
-- ============================================================================

create table if not exists public.catalogue_items (
  id           uuid primary key default gen_random_uuid(),
  workspace    text not null default public.current_workspace() references public.workspaces (id),
  name         text not null,
  details      text,
  kind         text not null default 'service',
  code         text,
  unit         text,
  unit_price   numeric(14, 2) not null default 0,
  currency     text not null default 'LKR',
  prices       jsonb not null default '{}'::jsonb,
  tax_rate_ids uuid[] not null default '{}',
  active       boolean not null default true,
  position     integer not null default 0,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.catalogue_items is
  'Saved products and services for quotes and invoices (0034). Lines copy them; nothing links back.';
comment on column public.catalogue_items.prices is 'Prices in other currencies: {"USD": 120.00}.';
comment on column public.catalogue_items.tax_rate_ids is 'tax_rates a new line from this item carries.';

alter table public.catalogue_items drop constraint if exists catalogue_items_values_check;
alter table public.catalogue_items
  add constraint catalogue_items_values_check check (
    btrim(name) <> '' and char_length(name) <= 200
    and (details is null or char_length(details) <= 2000)
    and kind in ('service', 'product')
    and (code is null or char_length(code) <= 40)
    and (unit is null or char_length(unit) <= 20)
    and unit_price >= 0
    and currency ~ '^[A-Z]{3}$'
    and jsonb_typeof(prices) = 'object'
    and cardinality(tax_rate_ids) <= 4
  );

create unique index if not exists catalogue_items_code_key
  on public.catalogue_items (workspace, lower(btrim(code))) where code is not null and btrim(code) <> '';
create index if not exists catalogue_items_workspace_idx on public.catalogue_items (workspace, active, position);

drop trigger if exists catalogue_items_set_updated_at on public.catalogue_items;
create trigger catalogue_items_set_updated_at
  before update on public.catalogue_items
  for each row execute function public.set_updated_at();

drop trigger if exists catalogue_items_stamp on public.catalogue_items;
create trigger catalogue_items_stamp
  before insert on public.catalogue_items
  for each row execute function private.stamp_created_by();

drop trigger if exists catalogue_items_activity on public.catalogue_items;
create trigger catalogue_items_activity
  after insert or update or delete on public.catalogue_items
  for each row execute function private.log_activity('catalogue item', 'name', '');

alter table public.catalogue_items enable row level security;

drop policy if exists "workspace fence" on public.catalogue_items;
create policy "workspace fence" on public.catalogue_items as restrictive for all to authenticated
  using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
  with check (workspace = (select public.current_workspace()) and (select public.is_active_member()));

drop policy if exists "catalogue: module" on public.catalogue_items;
create policy "catalogue: module"
  on public.catalogue_items for all to authenticated
  using ((select public.can_access('invoices')))
  with check ((select public.can_access('invoices')));

revoke all on public.catalogue_items from anon;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'powersync')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'powersync' and schemaname = 'public' and tablename = 'catalogue_items') then
    alter publication powersync add table public.catalogue_items;
  end if;
end;
$$;
