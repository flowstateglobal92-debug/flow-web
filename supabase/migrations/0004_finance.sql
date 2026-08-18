-- ============================================================================
-- 0004 · Finance (income & expenses ledger)
-- One permanent table for every rupee in and out. `amount` is always stored
-- positive; `signed_amount` is generated (+income / −expense) so profit & loss
-- is a plain sum and goes negative the moment expenses overtake income.
-- Requires: 0001 (is_admin, set_updated_at), 0003 (leads — optional link)
-- ============================================================================

do $$ begin
  create type public.finance_kind as enum ('income', 'expense');
exception when duplicate_object then null;
end $$;

create table if not exists public.finance_entries (
  id             uuid primary key default gen_random_uuid(),
  kind           public.finance_kind not null,
  entry_date     date not null default current_date,
  description    text not null,
  category       text not null default 'General',
  amount         numeric(14, 2) not null check (amount > 0),
  -- +income / −expense: sum this column for profit & loss.
  signed_amount  numeric(14, 2)
                   generated always as (case when kind = 'income' then amount else -amount end) stored,
  currency       text not null default 'LKR',
  method         text,                       -- cash, bank transfer, card…
  reference      text,                       -- invoice / receipt number
  lead_id        uuid references public.leads (id) on delete set null,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.finance_entries is
  'Permanent income/expense ledger. signed_amount is +income / −expense.';

create index if not exists finance_entries_date_idx on public.finance_entries (entry_date desc);
create index if not exists finance_entries_kind_date_idx on public.finance_entries (kind, entry_date desc);
create index if not exists finance_entries_category_idx on public.finance_entries (category);

drop trigger if exists finance_entries_set_updated_at on public.finance_entries;
create trigger finance_entries_set_updated_at
  before update on public.finance_entries
  for each row execute function public.set_updated_at();

-- ──────────────────────── reporting views ──────────────────────────────────
-- security_invoker: the view is read under the caller's RLS, not the owner's.
create or replace view public.finance_monthly
with (security_invoker = on) as
select
  date_trunc('month', entry_date)::date                                as month,
  sum(amount) filter (where kind = 'income')::numeric(14, 2)           as income,
  sum(amount) filter (where kind = 'expense')::numeric(14, 2)          as expense,
  coalesce(sum(signed_amount), 0)::numeric(14, 2)                      as profit,
  count(*)                                                             as entries
from public.finance_entries
group by 1
order by 1 desc;

create or replace view public.finance_totals
with (security_invoker = on) as
select
  coalesce(sum(amount) filter (where kind = 'income'), 0)::numeric(14, 2)  as income,
  coalesce(sum(amount) filter (where kind = 'expense'), 0)::numeric(14, 2) as expense,
  coalesce(sum(signed_amount), 0)::numeric(14, 2)                          as profit,
  count(*)                                                                 as entries
from public.finance_entries;

grant select on public.finance_monthly, public.finance_totals to authenticated;

-- ───────────────────────────── policies ────────────────────────────────────
alter table public.finance_entries enable row level security;

drop policy if exists "finance: admin manages" on public.finance_entries;
create policy "finance: admin manages"
  on public.finance_entries for all
  to authenticated
  using (public.is_admin()) with check (public.is_admin());
