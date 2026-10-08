-- ============================================================================
-- 0041 · Bank statements
-- Import a bank's CSV, then tie each line to the books: a ledger entry it
-- already is, a payment on an invoice, a payment of a bill, a new expense or
-- income — or set it aside (transfers between your own accounts).
--
--   bank_accounts — the accounts statements come from.
--   bank_lines — one row per statement line: date, description, reference,
--     amount (+ money in, − money out), the running balance if the bank gives
--     one. A fingerprint (date, amount, text, and which occurrence of that
--     same line it is) makes importing the same file twice harmless.
--     Matched to at most one ledger entry, and a ledger entry to at most one
--     line.
--   bank_line_suggestions(line) — ledger entries, open invoices and open
--     bills it could be: same amount (in rupees), close in date, not matched
--     already, best first.
-- Everything here is the Expenses module's.
-- Requires: 0040. Idempotent.
-- ============================================================================

create table if not exists public.bank_accounts (
  id          uuid primary key default gen_random_uuid(),
  workspace   text not null default public.current_workspace() references public.workspaces (id),
  name        text not null,
  currency    text not null default 'LKR',
  last4       text,
  active      boolean not null default true,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.bank_accounts drop constraint if exists bank_accounts_values_check;
alter table public.bank_accounts
  add constraint bank_accounts_values_check check (
    btrim(name) <> '' and char_length(name) <= 120 and currency ~ '^[A-Z]{3}$'
    and (last4 is null or last4 ~ '^[0-9A-Za-z]{2,6}$')
  );

create table if not exists public.bank_lines (
  id                uuid primary key default gen_random_uuid(),
  workspace         text not null default public.current_workspace() references public.workspaces (id),
  account_id        uuid not null references public.bank_accounts (id) on delete cascade,
  posted_on         date not null,
  description       text not null default '',
  reference         text,
  amount            numeric(14, 2) not null,
  balance           numeric(14, 2),
  fingerprint       text not null,
  status            text not null default 'unmatched',
  matched_entry_id  uuid references public.finance_entries (id) on delete set null,
  note              text,
  import_id         uuid,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.bank_lines is 'Imported bank statement lines and what they match in the books (0041).';

alter table public.bank_lines drop constraint if exists bank_lines_values_check;
alter table public.bank_lines
  add constraint bank_lines_values_check check (
    amount <> 0
    and status in ('unmatched', 'matched', 'ignored')
    and (status = 'matched') = (matched_entry_id is not null)
    and char_length(description) <= 500
    and (reference is null or char_length(reference) <= 120)
    and (note is null or char_length(note) <= 500)
  );

create unique index if not exists bank_lines_fingerprint_key on public.bank_lines (account_id, fingerprint);
create unique index if not exists bank_lines_entry_key on public.bank_lines (matched_entry_id) where matched_entry_id is not null;
create index if not exists bank_lines_account_idx on public.bank_lines (account_id, posted_on desc);

-- A line's status follows its match: matched when it has an entry, back to
-- unmatched when the entry goes (or is unlinked).
create or replace function private.bank_line_status()
returns trigger
language plpgsql
as $$
begin
  if new.matched_entry_id is not null then
    new.status := 'matched';
  elsif new.status = 'matched' then
    new.status := 'unmatched';
  end if;
  return new;
end;
$$;

revoke execute on function private.bank_line_status() from public, anon, authenticated;

drop trigger if exists bank_lines_status on public.bank_lines;
create trigger bank_lines_status
  before insert or update on public.bank_lines
  for each row execute function private.bank_line_status();

do $$
declare
  t text;
begin
  foreach t in array array['bank_accounts', 'bank_lines'] loop
    execute format('drop trigger if exists %1$s_set_updated_at on public.%1$I', t);
    execute format('create trigger %1$s_set_updated_at before update on public.%1$I for each row execute function public.set_updated_at()', t);
    execute format('drop trigger if exists %1$s_stamp on public.%1$I', t);
    execute format('create trigger %1$s_stamp before insert on public.%1$I for each row execute function private.stamp_created_by()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "workspace fence" on public.%I', t);
    execute format($p$create policy "workspace fence" on public.%I as restrictive for all to authenticated
      using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
      with check (workspace = (select public.current_workspace()) and (select public.is_active_member()))$p$, t);
    execute format('drop policy if exists "%1$s: module" on public.%1$I', t);
    execute format($p$create policy "%1$s: module" on public.%1$I for all to authenticated
      using ((select public.can_access('finance'))) with check ((select public.can_access('finance')))$p$, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end;
$$;

-- What a line could be, best first. Amounts compare in rupees (the ledger is
-- LKR; invoices and bills at their rate). Score: the same amount to the cent,
-- then nearness in date, then a reference or name in the description.
-- Definer (it converts with private.base_amount), so it checks Expenses
-- access itself and reads only the caller's own workspace.
create or replace function public.bank_line_suggestions(p_line uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l   public.bank_lines;
  amt numeric(14, 2);
  d   text;
begin
  if not public.can_access('finance') then
    raise exception 'You don''t have access to Expenses.' using errcode = '42501';
  end if;
  select * into l from public.bank_lines where id = p_line and workspace = public.current_workspace();
  if not found then
    raise exception 'That line isn''t available.' using errcode = 'P0002';
  end if;
  amt := abs(l.amount);
  d := lower(coalesce(l.description, '') || ' ' || coalesce(l.reference, ''));

  return jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(x order by (x ->> 'score')::numeric desc, x ->> 'date')
      from (
        select jsonb_build_object(
                 'id', f.id, 'date', f.entry_date, 'description', f.description, 'category', f.category,
                 'amount', f.signed_amount, 'reference', f.reference,
                 'score', 100 - least(abs(f.entry_date - l.posted_on), 30)
                          + case when f.reference is not null and position(lower(f.reference) in d) > 0 then 20 else 0 end) as x
        from public.finance_entries f
        where f.workspace = l.workspace
          and f.approval_status = 'approved'
          and abs(f.amount) = amt
          and sign(f.signed_amount) = sign(l.amount)
          and f.entry_date between l.posted_on - 21 and l.posted_on + 21
          and not exists (select 1 from public.bank_lines b where b.matched_entry_id = f.id)
        limit 20
      ) s
    ), '[]'::jsonb),
    'invoices', case when l.amount > 0 then coalesce((
      select jsonb_agg(x order by (x ->> 'score')::numeric desc)
      from (
        select jsonb_build_object(
                 'id', i.id, 'number', i.number, 'client', coalesce(nullif(btrim(i.bill_to_company), ''), i.bill_to_name),
                 'currency', i.currency, 'balance', i.balance_due,
                 'balance_lkr', private.base_amount(i.balance_due, i.currency, i.exchange_rate),
                 'due_date', i.due_date,
                 'score', case when private.base_amount(i.balance_due, i.currency, i.exchange_rate) = amt then 100 else 40 end
                          + case when i.number is not null and position(lower(i.number) in d) > 0 then 50 else 0 end
                          + case when position(lower(coalesce(nullif(btrim(i.bill_to_company), ''), i.bill_to_name)) in d) > 0 then 20 else 0 end) as x
        from public.invoices i
        where i.workspace = l.workspace and i.kind = 'invoice'
          and i.status in ('issued', 'partially_paid') and i.balance_due > 0
          and (private.base_amount(i.balance_due, i.currency, i.exchange_rate) >= amt
               or (i.number is not null and position(lower(i.number) in d) > 0))
        limit 50
      ) s
    ), '[]'::jsonb) else '[]'::jsonb end,
    'bills', case when l.amount < 0 then coalesce((
      select jsonb_agg(x order by (x ->> 'score')::numeric desc)
      from (
        select jsonb_build_object(
                 'id', b.id, 'reference', b.reference, 'supplier', sp.name,
                 'currency', b.currency, 'balance', b.balance_due,
                 'balance_lkr', private.base_amount(b.balance_due, b.currency, b.exchange_rate),
                 'due_date', b.due_date,
                 'score', case when private.base_amount(b.balance_due, b.currency, b.exchange_rate) = amt then 100 else 40 end
                          + case when b.reference is not null and position(lower(b.reference) in d) > 0 then 50 else 0 end
                          + case when position(lower(sp.name) in d) > 0 then 20 else 0 end) as x
        from public.bills b
        join public.suppliers sp on sp.id = b.supplier_id
        where b.workspace = l.workspace and b.status in ('open', 'partially_paid') and b.balance_due > 0
          and private.base_amount(b.balance_due, b.currency, b.exchange_rate) >= amt
        limit 50
      ) s
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

revoke execute on function public.bank_line_suggestions(uuid) from public, anon, authenticated;
grant execute on function public.bank_line_suggestions(uuid) to authenticated, service_role;

-- ───────────────────────────── desktop sync ────────────────────────────────
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'powersync') then
    return;
  end if;
  foreach t in array array['bank_accounts', 'bank_lines'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'powersync' and schemaname = 'public' and tablename = t) then
      execute format('alter publication powersync add table public.%I', t);
    end if;
  end loop;
end;
$$;
