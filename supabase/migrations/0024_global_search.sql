-- ============================================================================
-- 0024 · Global search (⌘K)
-- One RPC behind the command palette: search_everything(q) looks through
-- clients, leads, invoices, quotes, to-dos, events and inquiries and returns
-- up to per_type hits of each, ready to show — a title, a muted line and the
-- deep link (exactly as src/lib/admin/links.ts builds them).
--
-- It's security invoker: every table is read under the caller's own RLS, so
-- results are only ever things the caller could open anyway — a CRM-only
-- member finds leads and the clients they can pick, never an invoice; private
-- to-dos stay with their participants; the demo finds demo rows only.
--
-- Matching: every word typed must appear somewhere in the record's searched
-- text (case-insensitive substring; % and _ are taken literally). Hits whose
-- title is the query, then starts with it, then contains it, come first.
--
-- Trigram GIN indexes cover that same text (the expressions below and in the
-- function must stay identical for the planner to match them). Trusted
-- callers (service role, SQL) get index scans; under RLS Postgres won't use
-- them for the caller's ILIKE — it isn't leakproof, so it has to wait for the
-- policies — and the RPC scans instead: ~30 ms at 20,000 rows a table.
-- Requires: 0023
-- ============================================================================

create extension if not exists pg_trgm with schema extensions;

-- Indexed wherever pg_trgm lives (extensions on a fresh Supabase project).
do $$
declare
  trgm text := (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
                where e.extname = 'pg_trgm');
  ix   record;
begin
  for ix in
    select * from (values
      ('clients_search_trgm_idx', 'clients',
       $x$(coalesce(name, '') || ' ' || coalesce(company, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, ''))$x$),
      ('leads_search_trgm_idx', 'leads',
       $x$(coalesce(name, '') || ' ' || coalesce(company, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, ''))$x$),
      ('invoices_search_trgm_idx', 'invoices',
       $x$(coalesce(number, '') || ' ' || coalesce(bill_to_name, '') || ' ' || coalesce(bill_to_company, '') || ' ' || coalesce(bill_to_email, '') || ' ' || coalesce(subject, ''))$x$),
      ('todos_search_trgm_idx', 'todos',
       $x$(coalesce(title, '') || ' ' || coalesce(notes, ''))$x$),
      ('calendar_events_search_trgm_idx', 'calendar_events',
       $x$(coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(location, ''))$x$),
      ('inquiries_search_trgm_idx', 'inquiries',
       $x$(coalesce(name, '') || ' ' || coalesce(business, '') || ' ' || coalesce(contact, '') || ' ' || coalesce(focus, ''))$x$)
    ) as v(name, tbl, expr)
  loop
    execute format('create index if not exists %I on public.%I using gin (%s %I.gin_trgm_ops)', ix.name, ix.tbl, ix.expr, trgm);
  end loop;
end $$;

-- ─────────────────────────────── the RPC ───────────────────────────────────
-- Results come grouped by type, in palette order: client, lead, invoice,
-- quote, todo, event, inquiry. Fewer than two characters finds nothing.
create or replace function public.search_everything(q text, per_type integer default 5)
returns table (entity_type text, id uuid, title text, subtitle text, href text)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  term     text := left(lower(regexp_replace(btrim(coalesce(q, '')), '\s+', ' ', 'g')), 80);
  lim      integer := least(greatest(coalesce(per_type, 5), 1), 20);
  safe     text;
  pats     text[];
  main     text;
  starts   text;
  inside   text;
  doc      text;
begin
  if length(term) < 2 then
    return;
  end if;

  -- Typed wildcards are literal: \ % _ are escaped for ILIKE.
  safe := replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_');
  starts := safe || '%';
  inside := '%' || safe || '%';
  pats := array(
    select '%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    from unnest(string_to_array(term, ' ')) as w
    where w <> ''
    limit 6
  );
  -- The longest word drives the index; the rest are checked on what it finds.
  main := (select p from unnest(pats) as p order by length(p) desc limit 1);

  return query
  select 'client'::text, c.id, c.name,
         nullif(concat_ws(' · ',
           case when nullif(btrim(c.company), '') is distinct from c.name then nullif(btrim(c.company), '') end,
           nullif(btrim(c.email), ''),
           case c.status when 'prospect' then 'Prospect' when 'archived' then 'Archived' end), ''),
         '/admin/clients/' || c.id
  from public.clients c
  where (coalesce(c.name, '') || ' ' || coalesce(c.company, '') || ' ' || coalesce(c.email, '') || ' ' || coalesce(c.phone, '')) ilike main
    and (coalesce(c.name, '') || ' ' || coalesce(c.company, '') || ' ' || coalesce(c.email, '') || ' ' || coalesce(c.phone, '')) ilike all (pats)
  order by case when lower(c.name) = term then 0 when c.name ilike starts then 1 when c.name ilike inside then 2 else 3 end,
           c.status = 'archived', c.updated_at desc, c.id
  limit lim;

  return query
  select 'lead'::text, l.id, l.name,
         nullif(concat_ws(' · ',
           nullif(btrim(l.company), ''),
           s.name,
           case when l.value > 0 then 'Rs ' || to_char(round(l.value), 'FM999,999,999,990') end), ''),
         '/admin/crm?lead=' || l.id
  from public.leads l
  left join public.pipeline_stages s on s.id = l.stage_id
  where (coalesce(l.name, '') || ' ' || coalesce(l.company, '') || ' ' || coalesce(l.email, '') || ' ' || coalesce(l.phone, '')) ilike main
    and (coalesce(l.name, '') || ' ' || coalesce(l.company, '') || ' ' || coalesce(l.email, '') || ' ' || coalesce(l.phone, '')) ilike all (pats)
  order by least(
             case when lower(l.name) = term then 0 when l.name ilike starts then 1 when l.name ilike inside then 2 else 3 end,
             case when lower(l.company) = term then 0 when l.company ilike starts then 1 when l.company ilike inside then 2 else 3 end),
           l.updated_at desc, l.id
  limit lim;

  -- Invoices, then quotes: the same table, a page of each.
  foreach doc in array array['invoice', 'quote'] loop
    return query
    select i.kind, i.id,
           coalesce(i.number, 'Draft ' || i.kind),
           nullif(concat_ws(' · ',
             coalesce(nullif(btrim(i.bill_to_company), ''), nullif(btrim(i.bill_to_name), '')),
             nullif(btrim(i.subject), ''),
             case when i.number is not null then
               case i.status when 'issued' then 'Unpaid' when 'partially_paid' then 'Part paid'
                             else upper(left(i.status, 1)) || replace(substr(i.status, 2), '_', ' ') end
             end,
             case when i.currency = 'LKR' then 'Rs ' else i.currency || ' ' end
               || regexp_replace(to_char(i.total, 'FM999,999,999,990.00'), '\.00$', '')), ''),
           '/admin/invoices/' || i.id
    from public.invoices i
    where i.kind = doc
      and (coalesce(i.number, '') || ' ' || coalesce(i.bill_to_name, '') || ' ' || coalesce(i.bill_to_company, '') || ' ' || coalesce(i.bill_to_email, '') || ' ' || coalesce(i.subject, '')) ilike main
      and (coalesce(i.number, '') || ' ' || coalesce(i.bill_to_name, '') || ' ' || coalesce(i.bill_to_company, '') || ' ' || coalesce(i.bill_to_email, '') || ' ' || coalesce(i.subject, '')) ilike all (pats)
    order by least(
               case when lower(i.number) = term then 0 when i.number ilike starts then 1 when i.number ilike inside then 2 else 3 end,
               case when lower(i.bill_to_company) = term then 0 when i.bill_to_company ilike starts then 1
                    when i.bill_to_company ilike inside then 2 else 3 end,
               case when lower(i.bill_to_name) = term then 0 when i.bill_to_name ilike starts then 1
                    when i.bill_to_name ilike inside then 2 else 3 end),
             i.issue_date desc, i.created_at desc, i.id
    limit lim;
  end loop;

  return query
  select 'todo'::text, t.id, t.title,
         nullif(concat_ws(' · ',
           case t.status when 'done' then 'Done' when 'in_progress' then 'In progress' end,
           case when t.due_at is not null then 'Due ' || to_char(t.due_at at time zone 'Asia/Colombo', 'FMDD Mon YYYY') end,
           case when t.is_private then 'Private' end), ''),
         '/admin/todos?open=' || t.id
  from public.todos t
  where (coalesce(t.title, '') || ' ' || coalesce(t.notes, '')) ilike main
    and (coalesce(t.title, '') || ' ' || coalesce(t.notes, '')) ilike all (pats)
  order by case when lower(t.title) = term then 0 when t.title ilike starts then 1 when t.title ilike inside then 2 else 3 end,
           t.status = 'done', t.updated_at desc, t.id
  limit lim;

  -- Nearest to now first: the meeting you're looking for is usually this week's.
  return query
  select 'event'::text, e.id, e.title,
         nullif(concat_ws(' · ',
           to_char(e.starts_at at time zone 'Asia/Colombo', 'Dy FMDD Mon YYYY')
             || case when e.all_day then '' else ', ' || to_char(e.starts_at at time zone 'Asia/Colombo', 'HH24:MI') end,
           nullif(btrim(e.location), '')), ''),
         '/admin/calendar?event=' || e.id
  from public.calendar_events e
  where (coalesce(e.title, '') || ' ' || coalesce(e.description, '') || ' ' || coalesce(e.location, '')) ilike main
    and (coalesce(e.title, '') || ' ' || coalesce(e.description, '') || ' ' || coalesce(e.location, '')) ilike all (pats)
  order by case when lower(e.title) = term then 0 when e.title ilike starts then 1 when e.title ilike inside then 2 else 3 end,
           abs(extract(epoch from e.starts_at - now())), e.id
  limit lim;

  return query
  select 'inquiry'::text, n.id, n.name,
         nullif(concat_ws(' · ', nullif(btrim(n.business), ''), nullif(btrim(n.contact), ''), initcap(n.status::text)), ''),
         '/admin/inquiries?open=' || n.id
  from public.inquiries n
  where (coalesce(n.name, '') || ' ' || coalesce(n.business, '') || ' ' || coalesce(n.contact, '') || ' ' || coalesce(n.focus, '')) ilike main
    and (coalesce(n.name, '') || ' ' || coalesce(n.business, '') || ' ' || coalesce(n.contact, '') || ' ' || coalesce(n.focus, '')) ilike all (pats)
  order by least(
             case when lower(n.name) = term then 0 when n.name ilike starts then 1 when n.name ilike inside then 2 else 3 end,
             case when lower(n.business) = term then 0 when n.business ilike starts then 1 when n.business ilike inside then 2 else 3 end),
           n.created_at desc, n.id
  limit lim;
end;
$$;

revoke execute on function public.search_everything(text, integer) from public, anon, authenticated;
grant execute on function public.search_everything(text, integer) to authenticated, service_role;
