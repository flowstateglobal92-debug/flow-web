-- ============================================================================
-- 0025 · Demo seed
-- The demo workspace is a shop window. Prospects sign in as demo@flowstate.com
-- and should find a small agency in an ordinary week: leads moving through the
-- pipeline, invoices paid, part paid and overdue, a retainer billing itself,
-- a budget close to its limit, things waiting for approval, people tagged on
-- to-dos and meetings, and a bell with something in it. Visitors may change
-- anything; this puts it all back.
--
--   reset_demo_workspace(p_demo, p_team) — the service role's entry point
--     (Team → Demo, and the sign-in heal once the data is 12 hours old).
--     p_demo is the demo login, an admin of the demo workspace; p_team is the
--     three fictional teammates in DEMO_TEAM order (src/lib/admin/demo.ts):
--     Maya (project lead), Kavin (sales), Nadia (finance).
--   private.reset_demo_data() — the same for pg_cron, nightly at 03:00
--     Colombo. It finds the accounts by app_metadata.demo_key itself.
--     Receipt files visitors uploaded are cleared by the app's reset path
--     (Storage API), not here.
--
-- One transaction. The seed acts as the demo login (request.jwt.claims), so
-- defaults, stamps and approvals behave as they would for it, and runs with
-- flowstate.seeding on: triggers raise no alerts and log no activity, and the
-- seed writes a curated set of both instead. Every date is relative to
-- local_today(), so the demo always looks like this week. Once the data is
-- in, reminders still ahead (events, to-dos, overdue invoices) are scheduled
-- the normal way, so the bell keeps ringing during a visit.
--
-- Live rows are never touched, and that's checked rather than assumed:
-- before the wipe, no live row may point at a demo row (a cascade or a
-- set-null would reach it); afterwards, no live row may carry the xid this
-- reset wrote with. Either failure rolls the whole reset back. (So call it
-- in its own transaction, or a savepoint, after any live writes.)
--
-- Also here: the API can no longer mark a stage protected, or change a
-- protected stage's slug. Nobody can delete or rename a protected stage
-- (0003), so a visitor could otherwise plant one on the demo board for good.
-- Requires: 0024
-- ============================================================================

-- ─────────────────────── protected stages stay put ─────────────────────────
-- Invoker on purpose (see private.guard_profiles): only API callers are held
-- to it. The seed and the legacy import manage the protected stage themselves.
create or replace function private.guard_stage_flags()
returns trigger
language plpgsql
security invoker
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.is_protected and (tg_op = 'INSERT' or not old.is_protected) then
    raise exception 'Only the first stage is protected — a new stage can always be removed.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and old.is_protected and new.slug is distinct from old.slug then
    raise exception 'The "%" stage keeps its key — inquiries land there.', old.name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_stage_flags() from public, anon, authenticated;

drop trigger if exists pipeline_stages_guard_flags on public.pipeline_stages;
create trigger pipeline_stages_guard_flags
  before insert or update on public.pipeline_stages
  for each row execute function private.guard_stage_flags();

-- ──────────────────── links stay inside their workspace ─────────────────────
-- Foreign keys ignore RLS, so without these a live row could point at a demo
-- lead or invoice (its id is visible to anyone in the demo) — and then the
-- reset below would refuse to run. 0011/0018/0020 guard the newer tables the
-- same way; these are the older links and the ledger's.
drop trigger if exists finance_entries_guard_links on public.finance_entries;
create trigger finance_entries_guard_links
  before insert or update of lead_id, invoice_id, workspace on public.finance_entries
  for each row execute function private.guard_workspace_links('lead_id', 'leads', 'invoice_id', 'invoices');

drop trigger if exists leads_guard_links on public.leads;
create trigger leads_guard_links
  before insert or update of inquiry_id, workspace on public.leads
  for each row execute function private.guard_workspace_links('inquiry_id', 'inquiries');

drop trigger if exists inquiries_guard_links on public.inquiries;
create trigger inquiries_guard_links
  before insert or update of converted_lead_id, workspace on public.inquiries
  for each row execute function private.guard_workspace_links('converted_lead_id', 'leads');

drop trigger if exists lead_activities_guard_links on public.lead_activities;
create trigger lead_activities_guard_links
  before insert or update of lead_id, workspace on public.lead_activities
  for each row execute function private.guard_workspace_links('lead_id', 'leads');

-- ─────────────────────────────── helpers ───────────────────────────────────
-- A moment that has already happened: wall-clock time on a Colombo day, but
-- never later than a few minutes ago (the nightly run is at 03:00, before
-- "today, 10:30" exists).
create or replace function private.demo_at(p_day date, p_time time)
returns timestamptz
language sql
stable
as $$
  select least(private.local_at(p_day, p_time), now() - interval '7 minutes');
$$;

-- One demo invoice or quote with its lines, recomputed once. p_doc uses the
-- invoices columns (status may only start as draft or pending_approval —
-- the seed moves documents on afterwards); p_items is save_invoice's list.
create or replace function private.demo_doc(p_doc jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  d    public.invoices := jsonb_populate_record(null::public.invoices, p_doc);
  cfg  public.invoice_settings;
  v_id uuid;
  prev text := current_setting('flowstate.invoice_batch', true);
begin
  select * into cfg from public.invoice_settings where workspace = 'demo';

  insert into public.invoices (
    workspace, kind, status, client_id, lead_id, owner_id, bill_to_name, bill_to_company, bill_to_email,
    bill_to_address, subject, issue_date, due_date, valid_until, currency, discount_type, discount_value,
    tax_label, tax_rate, notes, terms, payment_details, source_quote_id, schedule_id, period_start,
    created_by, created_at
  ) values (
    'demo', coalesce(d.kind, 'invoice'), coalesce(d.status, 'draft'), d.client_id, d.lead_id, d.owner_id,
    coalesce(d.bill_to_name, ''), d.bill_to_company, d.bill_to_email, d.bill_to_address, d.subject,
    coalesce(d.issue_date, public.local_today()), d.due_date, d.valid_until, coalesce(d.currency, 'LKR'),
    coalesce(d.discount_type, 'amount'), coalesce(d.discount_value, 0), coalesce(d.tax_label, cfg.tax_label, 'VAT'),
    coalesce(d.tax_rate, 0), coalesce(d.notes, cfg.default_notes), coalesce(d.terms, cfg.default_terms),
    coalesce(d.payment_details, cfg.payment_details), d.source_quote_id, d.schedule_id, d.period_start,
    d.created_by, coalesce(d.created_at, now())
  )
  returning id into v_id;

  perform set_config('flowstate.invoice_batch', 'on', true);
  insert into public.invoice_items (invoice_id, position, description, details, quantity, unit_price)
  select v_id, (e.ord - 1)::integer, e.item ->> 'description', nullif(e.item ->> 'details', ''),
         coalesce((e.item ->> 'quantity')::numeric, 1), (e.item ->> 'unit_price')::numeric
  from jsonb_array_elements(p_items) with ordinality as e(item, ord);
  perform set_config('flowstate.invoice_batch', coalesce(prev, ''), true);

  update public.invoices set updated_at = now() where id = v_id;
  return v_id;
end;
$$;

revoke execute on function private.demo_at(date, time), private.demo_doc(jsonb, jsonb)
  from public, anon, authenticated;

-- ──────────────────────────────── the seed ─────────────────────────────────
-- No access check: reset_demo_workspace and reset_demo_data are its callers.
create or replace function private.seed_demo_workspace(p_demo uuid, p_team uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  alex  uuid := p_demo;
  maya  uuid := p_team[1];
  kavin uuid := p_team[2];
  nadia uuid := p_team[3];
  n_alex  text;
  n_maya  text;
  n_kavin text;
  n_nadia text;

  today date := public.local_today();
  m0    date := date_trunc('month', public.local_today()::timestamp)::date;    -- this month
  p1    date := (date_trunc('month', public.local_today()::timestamp) - interval '1 month')::date;
  p2    date := (date_trunc('month', public.local_today()::timestamp) - interval '2 months')::date;
  q0    date := date_trunc('quarter', public.local_today()::timestamp)::date;  -- this quarter

  -- Whatever the caller had set goes back at the end.
  prev_claims text := current_setting('request.jwt.claims', true);
  prev_sub    text := current_setting('request.jwt.claim.sub', true);
  prev_role   text := current_setting('request.jwt.claim.role', true);
  prev_seed   text := current_setting('flowstate.seeding', true);
  prev_import text := current_setting('flowstate.importing', true);
  prev_batch  text := current_setting('flowstate.invoice_batch', true);

  v_xid  xid;
  r      record;
  n      bigint;
  linked boolean;
  first_stage text;

  s_new uuid; s_contacted uuid; s_proposal uuid; s_negotiation uuid; s_won uuid; s_lost uuid;
  c_lotus uuid; c_pepper uuid; c_ruhuna uuid; c_harbour uuid; c_spice uuid; c_dental uuid;
  q_ella uuid; q_bake uuid; q_hardware uuid; q_learning uuid;
  l_ella uuid; l_bake uuid; l_batik uuid; l_spice uuid; l_silk uuid;
  l_dental uuid; l_lotus uuid; l_harbour uuid; l_pepper uuid; l_ruhuna uuid; l_fitness uuid;
  s_retainer uuid;
  qt_ruhuna uuid; qt_fitness uuid; qt_lotus uuid; qt_dental uuid;
  i_deposit uuid; i_spice uuid; i_ruhuna uuid; i_void uuid; i_workshop uuid; i_final uuid;
  i_shoot uuid; i_hosting uuid; i_phase1 uuid; i_r1 uuid; i_r2 uuid; i_r3 uuid;
  e_monitor uuid; e_offsite uuid; e_laptop uuid;
  b_software uuid;
  t_maya uuid; t_kavin uuid;
  ev_standup uuid; ev_kickoff uuid; ev_harbour uuid; ev_shoot uuid; ev_dental uuid; ev_finance uuid;
  ev_pepper uuid; ev_silk uuid; ev_ella uuid;
  td_timeline uuid; td_chase uuid; td_sow uuid; td_licences uuid; td_photographer uuid; td_posts uuid;
  td_batik uuid; td_budgets uuid; td_dental uuid; td_casestudy uuid; td_epf uuid;
  td_contract uuid; td_mockups uuid;
  cm_chase uuid; cm_harbour uuid; cm_ruhuna uuid;
  ar_laptop uuid; ar_phase1 uuid; ar_leave uuid; ar_monitor uuid; ar_offsite uuid; ar_maya uuid;

  ruhuna_items jsonb := '[
    {"description": "Brand refresh — logo, palette and type", "quantity": 1, "unit_price": 280000},
    {"description": "Packaging design — per SKU", "details": "Curd, kithul treacle, jaggery, coconut oil",
     "quantity": 4, "unit_price": 85000}
  ]';
  retainer jsonb;
begin
  -- ── who
  if p_demo is null or array_ndims(p_team) is distinct from 1 or cardinality(p_team) <> 3 then
    raise exception 'Pass the demo login and its three teammates (Maya, Kavin, Nadia), in that order.'
      using errcode = '22023';
  end if;
  if array_position(p_team, null) is not null
     or p_demo = any (p_team)
     or (select count(distinct x) from unnest(p_team) as x) <> 3 then
    raise exception 'Pass the demo login and its three teammates (Maya, Kavin, Nadia), in that order.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(array[p_demo] || p_team) as x(id)
    where not exists (select 1 from public.profiles p where p.id = x.id and p.workspace = 'demo')
  ) then
    raise exception 'Every demo account must be a profile in the demo workspace.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_demo and p.is_active and p.role = 'admin') then
    raise exception 'The demo login must be an active admin of the demo workspace.' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(full_name), ''), email) into n_alex from public.profiles where id = alex;
  select coalesce(nullif(btrim(full_name), ''), email) into n_maya from public.profiles where id = maya;
  select coalesce(nullif(btrim(full_name), ''), email) into n_kavin from public.profiles where id = kavin;
  select coalesce(nullif(btrim(full_name), ''), email) into n_nadia from public.profiles where id = nadia;

  -- Act as the demo login. Both claim styles, whichever auth.uid() reads.
  perform set_config('request.jwt.claims', json_build_object('sub', alex, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', alex::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('flowstate.seeding', 'on', true);
  -- Lines and payments don't touch their invoice; the seed does, once.
  perform set_config('flowstate.invoice_batch', 'on', true);

  -- ── live rows can't be reached from here
  -- A live row pointing at a demo row would be deleted or nulled by the wipe.
  for r in
    select k.conrelid::regclass::text as child, a.attname as col,
           k.confrelid::regclass::text as parent, pa.attname as pcol
    from pg_constraint k
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
    join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = k.confkey[1]
    where k.contype = 'f'
      and cardinality(k.conkey) = 1
      and k.connamespace = 'public'::regnamespace
      and k.confrelid in (select c.oid from pg_class c where c.relnamespace = 'public'::regnamespace)
      and k.confrelid not in ('public.profiles'::regclass, 'public.workspaces'::regclass)
      and exists (select 1 from pg_attribute w where w.attrelid = k.conrelid and w.attname = 'workspace' and not w.attisdropped)
      and exists (select 1 from pg_attribute w where w.attrelid = k.confrelid and w.attname = 'workspace' and not w.attisdropped)
  loop
    execute format(
      'select exists (select 1 from %s x join %s y on y.%I = x.%I where y.workspace = %L and x.workspace <> %L)',
      r.child, r.parent, r.pcol, r.col, 'demo', 'demo'
    ) into linked;
    if linked then
      raise exception 'Live data points at the demo workspace (%.% → %), so resetting it would change live rows.',
        r.child, r.col, r.parent
        using errcode = 'check_violation';
    end if;
  end loop;

  -- The first write: settings back to their defaults. Its xid is the one
  -- every row this reset writes carries — checked against live rows at the end.
  update public.workspaces
  set expense_approval_threshold = 50000,
      invoice_approval_threshold = 500000,
      leave_requires_approval = true,
      opening_balance = 2350000,
      opening_balance_on = today
  where id = 'demo'
  returning xmin into v_xid;
  if v_xid is null then
    raise exception 'The demo workspace row is missing.' using errcode = 'P0002';
  end if;

  -- ── wipe, children before parents (the protected stage stays)
  delete from public.comments where workspace = 'demo';
  delete from public.todos where workspace = 'demo';
  delete from public.calendar_events where workspace = 'demo';
  delete from public.time_off where workspace = 'demo';
  delete from public.finance_attachments where workspace = 'demo';
  delete from public.budgets where workspace = 'demo';
  delete from public.budget_alerts where workspace = 'demo';
  delete from public.invoices where workspace = 'demo';
  delete from public.invoice_schedules where workspace = 'demo';
  delete from public.finance_entries where workspace = 'demo';
  delete from public.leads where workspace = 'demo';
  delete from public.lead_activities where workspace = 'demo';
  delete from public.inquiries where workspace = 'demo';
  delete from public.clients where workspace = 'demo';
  delete from public.pipeline_stages where workspace = 'demo' and not is_protected;
  delete from public.email_states where workspace = 'demo';
  delete from public.approval_requests where workspace = 'demo';
  delete from public.notifications where workspace = 'demo';
  delete from public.activity_log where workspace = 'demo';

  insert into public.invoice_settings (workspace) values ('demo') on conflict do nothing;
  update public.invoice_settings
  set business_name = 'Flow State', business_email = 'support@flowstate.lk', business_phone = null,
      business_address = 'Colombo, Sri Lanka', business_website = 'www.flowstate.lk', tax_id = null,
      default_currency = 'LKR', tax_label = 'VAT', default_tax_rate = 0, default_due_days = 14,
      default_notes = 'Thank you for your business.',
      default_terms = 'Payment due within 14 days of the invoice date.',
      payment_details = 'Bank transfer · Flow State · Demo Bank PLC · Account 0000 1234 5678 · Colombo 03',
      invoice_prefix = 'INV', quote_prefix = 'QT', next_invoice_number = 1, next_quote_number = 1
  where workspace = 'demo';

  -- ── pipeline
  select id, name into s_new, first_stage from public.pipeline_stages
  where workspace = 'demo' and is_protected
  order by position, created_at
  limit 1;
  if s_new is null then
    insert into public.pipeline_stages (workspace, name, slug, position, tone, is_protected)
    values ('demo', 'New leads', 'new', 0, 'terra', true)
    returning id, name into s_new, first_stage;
  else
    -- Name and position are fixed by 0003's guard; the rest goes back.
    update public.pipeline_stages set slug = 'new', tone = 'terra', is_won = false, is_lost = false where id = s_new;
  end if;
  insert into public.pipeline_stages (workspace, name, slug, position, tone) values ('demo', 'Contacted', 'contacted', 1, 'cream')
    returning id into s_contacted;
  insert into public.pipeline_stages (workspace, name, slug, position, tone) values ('demo', 'Proposal', 'proposal', 2, 'cream')
    returning id into s_proposal;
  insert into public.pipeline_stages (workspace, name, slug, position, tone) values ('demo', 'Negotiation', 'negotiation', 3, 'warn')
    returning id into s_negotiation;
  insert into public.pipeline_stages (workspace, name, slug, position, tone, is_won) values ('demo', 'Won', 'won', 4, 'success', true)
    returning id into s_won;
  insert into public.pipeline_stages (workspace, name, slug, position, tone, is_lost) values ('demo', 'Lost', 'lost', 5, 'muted', true)
    returning id into s_lost;

  -- ── clients
  insert into public.clients (workspace, name, company, email, address, city, country, website, notes, status,
                              account_manager_id, created_by, created_at)
  values ('demo', 'Dinesh Wickramasinghe', 'Lotus Bay Hotels', 'dinesh@lotusbay.example', 'Galle Road, Induruwa', 'Bentota',
          'Sri Lanka', 'lotusbay.example', 'Retainer: social, website care and a monthly report. Signs off on Fridays.',
          'active', maya, alex, private.demo_at(p2 - 20, '10:00'))
  returning id into c_lotus;
  insert into public.clients (workspace, name, company, email, address, city, country, website, notes, status,
                              account_manager_id, created_by, created_at)
  values ('demo', 'Chaminda Bandara', 'Ceylon Pepper Company', 'chaminda@ceylonpepper.example', 'Kandy Road', 'Matale',
          'Sri Lanka', 'ceylonpepper.example', 'Online store for whole and ground spices. Ships to the EU.',
          'active', kavin, kavin, private.demo_at(today - 80, '11:20'))
  returning id into c_pepper;
  insert into public.clients (workspace, name, company, email, address, city, country, notes, status,
                              account_manager_id, created_by, created_at)
  values ('demo', 'Nimal Gunasekara', 'Ruhuna Fresh Foods', 'nimal@ruhunafresh.example', 'Beach Road', 'Matara',
          'Sri Lanka', 'Family dairy and kithul business. New packaging rolls out this quarter.',
          'active', maya, maya, private.demo_at(today - 54, '15:00'))
  returning id into c_ruhuna;
  insert into public.clients (workspace, name, company, email, address, city, country, notes, status,
                              account_manager_id, created_by, created_at)
  values ('demo', 'Mohamed Rizwan', 'Harbourline Logistics', 'rizwan@harbourline.example', 'Port Access Road', 'Colombo 15',
          'Sri Lanka', 'Freight forwarder, 40 staff. Phase 1: CRM and an operations dashboard.',
          'active', alex, alex, private.demo_at(today - 31, '09:30'))
  returning id into c_harbour;
  insert into public.clients (workspace, name, company, email, city, country, website, notes, status,
                              account_manager_id, created_by, created_at)
  values ('demo', 'Wei Ling Tan', 'Spice Trail Travel', 'weiling@spicetrail.example', 'Singapore', 'Singapore',
          'spicetrail.example', 'Tour operator selling Sri Lanka trips. Billed in USD.',
          'active', nadia, alex, private.demo_at(today - 40, '13:10'))
  returning id into c_spice;
  insert into public.clients (workspace, name, company, email, address, city, country, status,
                              account_manager_id, created_by, created_at)
  values ('demo', 'Dr. Shanika Perera', 'Kandy Lake Dental', 'shanika@kandylakedental.example', 'Dalada Veediya', 'Kandy',
          'Sri Lanka', 'prospect', kavin, kavin, private.demo_at(today - 9, '12:00'))
  returning id into c_dental;

  -- ── inquiries (two of them became leads)
  insert into public.inquiries (workspace, name, business, contact, focus, message, page, status, created_at, updated_at)
  values ('demo', 'Asanka Herath', 'Ella Eco Lodge', 'asanka@ellaecolodge.example', 'Bookings',
          'Most of our bookings come in over WhatsApp and we lose track. We need a proper booking site.',
          '/solution', 'converted', private.demo_at(today - 6, '07:45'), private.demo_at(today - 6, '07:45'))
  returning id into q_ella;
  insert into public.inquiries (workspace, name, business, contact, focus, message, page, status, created_at, updated_at)
  values ('demo', 'Fathima Nazeer', 'Colombo Bake House', 'fathima@bakehouse.example', 'Online orders',
          'Cake orders come by phone and Instagram. Can we take orders and deposits online?',
          '/', 'converted', private.demo_at(today - 3, '21:10'), private.demo_at(today - 3, '21:10'))
  returning id into q_bake;
  insert into public.inquiries (workspace, name, business, contact, focus, message, page, status, created_at, updated_at)
  values ('demo', 'Lahiru Madushanka', 'Madu Hardware', 'lahiru@maduhardware.example', 'Stock & invoicing',
          'Three branches, stock in spreadsheets. Looking for something the whole team can use.',
          '/solution', 'new', now() - interval '3 hours', now() - interval '3 hours')
  returning id into q_hardware;
  insert into public.inquiries (workspace, name, business, contact, focus, message, page, status, created_at, updated_at)
  values ('demo', 'Ishara Wijesinghe', 'Lanka Learning Hub', 'ishara@learninghub.example', 'Website',
          'Tuition classes in Nugegoda. We need a site where parents can see timetables and pay fees.',
          '/', 'new', now() - interval '20 hours', now() - interval '20 hours')
  returning id into q_learning;
  insert into public.inquiries (workspace, name, business, contact, focus, message, page, status, notes, created_at, updated_at)
  values
    ('demo', 'Roshan Peiris', 'Peiris & Sons Printing', 'roshan@peirisprinting.example', 'Quotes & job tracking',
     'We quote print jobs by hand. Would like to see how you handle quotes.', '/', 'read',
     'Call back after the 15th — busy season.', private.demo_at(today - 9, '10:20'), private.demo_at(today - 8, '09:00')),
    ('demo', 'Kamal Silva', 'Rank Fast SEO', 'deals@rankfast.example', 'Other',
     'We can get your website to #1 on Google in 7 days. Reply for a price list.', '/', 'archived',
     null, private.demo_at(today - 12, '02:14'), private.demo_at(today - 11, '09:05'));

  -- ── leads (the seed writes their trail itself, so the stage trigger stays out)
  perform set_config('flowstate.importing', 'on', true);
  insert into public.leads (workspace, stage_id, name, company, email, value, score, source, notes, next_action,
                            position, inquiry_id, owner_id, created_by, created_at)
  values ('demo', s_new, 'Asanka Herath', 'Ella Eco Lodge', 'asanka@ellaecolodge.example', 650000, 'WARM', 'website',
          'Eight cabins, mostly foreign guests. Wants WhatsApp kept as a channel.', 'Book a discovery call',
          0, q_ella, kavin, kavin, private.demo_at(today - 6, '09:30'))
  returning id into l_ella;
  insert into public.leads (workspace, stage_id, name, company, email, value, score, source, next_action,
                            position, inquiry_id, owner_id, created_by, created_at)
  values ('demo', s_new, 'Fathima Nazeer', 'Colombo Bake House', 'fathima@bakehouse.example', 280000, 'HOT', 'website',
          'Send two ordering-site examples', 1, q_bake, kavin, kavin, private.demo_at(today - 2, '09:15'))
  returning id into l_bake;
  insert into public.leads (workspace, stage_id, name, company, value, score, source, next_action, position,
                            owner_id, created_by, created_at)
  values ('demo', s_contacted, 'Ruwan Senanayake', 'Southern Auto Parts', 420000, 'WARM', 'referral',
          'Visit the Galle showroom', 0, kavin, kavin, private.demo_at(today - 15, '14:00'));
  insert into public.leads (workspace, stage_id, name, company, value, score, source, next_action, position,
                            owner_id, created_by, created_at)
  values ('demo', s_contacted, 'Tharushi Jayawardena', 'Tharu Batiks', 350000, 'COLD', 'instagram',
          'Follow up after the festival season', 1, maya, maya, private.demo_at(today - 21, '16:30'))
  returning id into l_batik;
  insert into public.leads (workspace, stage_id, name, company, email, value, score, source, next_action, position,
                            client_id, owner_id, created_by, created_at)
  values ('demo', s_contacted, 'Wei Ling Tan', 'Spice Trail Travel', 'weiling@spicetrail.example', 540000, 'WARM',
          'existing client', 'Scope the phase 2 booking widget', 2, c_spice, maya, maya, private.demo_at(today - 11, '10:00'))
  returning id into l_spice;
  insert into public.leads (workspace, stage_id, name, company, value, score, source, next_action, position,
                            owner_id, created_by, created_at)
  values ('demo', s_proposal, 'Priya Raghavan', 'Jaffna Silk House', 480000, 'WARM', 'referral',
          'Revise the proposal with a smaller first phase', 0, kavin, kavin, private.demo_at(today - 18, '11:45'))
  returning id into l_silk;
  insert into public.leads (workspace, stage_id, name, company, email, value, score, source, next_action, position,
                            client_id, owner_id, created_by, created_at)
  values ('demo', s_proposal, 'Dr. Shanika Perera', 'Kandy Lake Dental', 'shanika@kandylakedental.example', 520000,
          'WARM', 'website', 'Walk her through the proposal', 1, c_dental, kavin, kavin, private.demo_at(today - 9, '11:30'))
  returning id into l_dental;
  insert into public.leads (workspace, stage_id, name, company, email, value, score, source, next_action, position,
                            client_id, owner_id, created_by, created_at)
  values ('demo', s_negotiation, 'Dinesh Wickramasinghe', 'Lotus Bay Hotels', 'dinesh@lotusbay.example', 1200000,
          'HOT', 'existing client', 'Turn the accepted quote into a 40% deposit invoice', 0, c_lotus, alex, maya,
          private.demo_at(today - 16, '10:10'))
  returning id into l_lotus;
  insert into public.leads (workspace, stage_id, name, company, email, value, score, source, next_action, position,
                            client_id, owner_id, created_by, created_at)
  values ('demo', s_negotiation, 'Mohamed Rizwan', 'Harbourline Logistics', 'rizwan@harbourline.example', 2400000,
          'HOT', 'linkedin', 'Phase 1 sign-off call', 1, c_harbour, alex, kavin, private.demo_at(today - 34, '15:20'))
  returning id into l_harbour;
  insert into public.leads (workspace, stage_id, name, company, email, value, score, source, position,
                            client_id, owner_id, created_by, created_at)
  values ('demo', s_won, 'Chaminda Bandara', 'Ceylon Pepper Company', 'chaminda@ceylonpepper.example', 950000, 'HOT',
          'referral', 0, c_pepper, kavin, kavin, private.demo_at(today - 82, '10:00'))
  returning id into l_pepper;
  insert into public.leads (workspace, stage_id, name, company, email, value, score, source, position,
                            client_id, owner_id, created_by, created_at)
  values ('demo', s_won, 'Nimal Gunasekara', 'Ruhuna Fresh Foods', 'nimal@ruhunafresh.example', 589000, 'WARM',
          'trade fair', 1, c_ruhuna, maya, maya, private.demo_at(today - 58, '13:40'))
  returning id into l_ruhuna;
  insert into public.leads (workspace, stage_id, name, company, value, score, source, notes, position,
                            owner_id, created_by, created_at)
  values ('demo', s_lost, 'Sanjeewa Fonseka', 'Galle Face Fitness', 300000, 'COLD', 'website',
          'Went with a freelancer on price. Revisit in the new year.', 0, kavin, kavin, private.demo_at(today - 40, '17:00'))
  returning id into l_fitness;
  perform set_config('flowstate.importing', coalesce(prev_import, ''), true);

  update public.inquiries set converted_lead_id = l_ella where id = q_ella;
  update public.inquiries set converted_lead_id = l_bake where id = q_bake;

  -- The trail: created, one move for anyone past the first column, and a few notes.
  insert into public.lead_activities (workspace, lead_id, kind, body, actor_id, created_at)
  select 'demo', l.id, 'created', format('Lead created in %s', first_stage), l.created_by, l.created_at
  from public.leads l where l.workspace = 'demo';
  insert into public.lead_activities (workspace, lead_id, kind, body, actor_id, created_at)
  select 'demo', l.id, 'stage', format('%s → %s', first_stage, s.name), l.owner_id,
         l.created_at + (now() - l.created_at) / 3
  from public.leads l join public.pipeline_stages s on s.id = l.stage_id
  where l.workspace = 'demo' and l.stage_id <> s_new;
  insert into public.lead_activities (workspace, lead_id, kind, body, actor_id, created_at) values
    ('demo', l_ella, 'note', 'Converted from the website inquiry. Bookings plus WhatsApp, eight cabins.', kavin,
     private.demo_at(today - 6, '09:31')),
    ('demo', l_lotus, 'meeting', 'Showed Dinesh the booking-engine prototype. He loved the rate calendar.', maya,
     private.demo_at(today - 4, '16:10')),
    ('demo', l_harbour, 'call', 'Rizwan confirmed the phase 1 budget. Wants the dashboard live before the January peak.',
     kavin, private.demo_at(today - 2, '11:40')),
    ('demo', l_dental, 'message', 'Sent the proposal PDF on WhatsApp.', kavin, private.demo_at(today - 2, '17:05')),
    ('demo', l_fitness, 'note', 'They went with a freelancer on price. Revisit in the new year.', kavin,
     private.demo_at(today - 25, '10:00'));

  -- ── recurring: the Lotus Bay retainer (three months in) and a care plan starting next month
  retainer := jsonb_build_object(
    'client_id', c_lotus, 'owner_id', alex,
    'bill_to_name', 'Dinesh Wickramasinghe', 'bill_to_company', 'Lotus Bay Hotels',
    'bill_to_email', 'accounts@lotusbay.example', 'bill_to_address', 'Galle Road, Induruwa, Bentota',
    'subject', 'Social & website care — monthly retainer', 'currency', 'LKR',
    'discount_type', 'amount', 'discount_value', 0, 'tax_label', 'VAT', 'tax_rate', 0,
    'items', '[
      {"description": "Social media management", "details": "12 posts, 8 stories, community replies", "quantity": 1, "unit_price": 110000},
      {"description": "Website care & hosting", "quantity": 1, "unit_price": 45000},
      {"description": "Monthly performance report", "quantity": 1, "unit_price": 30000}
    ]'::jsonb
  );
  insert into public.invoice_schedules (workspace, name, is_retainer, client_id, owner_id, template, amount, currency,
                                        frequency, anchor_date, next_run_on, occurrences, auto_issue, created_by, created_at)
  values ('demo', 'Lotus Bay · Social & website care', true, c_lotus, alex, retainer, 185000, 'LKR',
          'monthly', p2, (m0 + interval '1 month')::date, 3, true, alex, private.demo_at(p2 - 3, '15:00'))
  returning id into s_retainer;
  insert into public.invoice_schedules (workspace, name, is_retainer, client_id, owner_id, template, amount, currency,
                                        frequency, anchor_date, next_run_on, auto_issue, created_by, created_at)
  values ('demo', 'Ceylon Pepper · SEO care', false, c_pepper, nadia,
          jsonb_build_object(
            'client_id', c_pepper, 'owner_id', nadia, 'bill_to_name', 'Chaminda Bandara',
            'bill_to_company', 'Ceylon Pepper Company', 'bill_to_email', 'accounts@ceylonpepper.example',
            'subject', 'SEO care — monthly', 'currency', 'LKR',
            'items', '[{"description": "SEO care — content, links and a monthly report", "quantity": 1, "unit_price": 85000}]'::jsonb
          ),
          85000, 'LKR', 'monthly', (m0 + interval '1 month')::date + 4, (m0 + interval '1 month')::date + 4,
          false, alex, private.demo_at(today - 5, '12:00'));

  -- ── quotes
  qt_ruhuna := private.demo_doc(jsonb_build_object(
      'kind', 'quote', 'client_id', c_ruhuna, 'lead_id', l_ruhuna, 'owner_id', nadia,
      'bill_to_name', 'Nimal Gunasekara', 'bill_to_company', 'Ruhuna Fresh Foods',
      'bill_to_email', 'nimal@ruhunafresh.example', 'bill_to_address', 'Beach Road, Matara',
      'subject', 'Brand refresh & packaging', 'issue_date', today - 52, 'valid_until', today - 38,
      'discount_type', 'percent', 'discount_value', 5,
      'created_by', nadia, 'created_at', private.demo_at(today - 53, '16:20')),
    ruhuna_items);
  qt_fitness := private.demo_doc(jsonb_build_object(
      'kind', 'quote', 'lead_id', l_fitness, 'owner_id', alex,
      'bill_to_name', 'Sanjeewa Fonseka', 'bill_to_company', 'Galle Face Fitness',
      'subject', 'Website & class bookings', 'issue_date', today - 35, 'valid_until', today - 21,
      'created_by', alex, 'created_at', private.demo_at(today - 36, '18:00')),
    '[{"description": "Website — six pages", "quantity": 1, "unit_price": 240000},
      {"description": "Class booking module", "quantity": 1, "unit_price": 60000}]');
  qt_lotus := private.demo_doc(jsonb_build_object(
      'kind', 'quote', 'client_id', c_lotus, 'lead_id', l_lotus, 'owner_id', alex,
      'bill_to_name', 'Dinesh Wickramasinghe', 'bill_to_company', 'Lotus Bay Hotels',
      'bill_to_email', 'dinesh@lotusbay.example', 'bill_to_address', 'Galle Road, Induruwa, Bentota',
      'subject', 'Booking engine', 'issue_date', today - 9, 'valid_until', today + 21,
      'notes', '40% deposit to start, 60% on launch.',
      'created_by', alex, 'created_at', private.demo_at(today - 10, '17:30')),
    '[{"description": "Booking engine — design and build", "details": "Rate calendar, packages, card deposits", "quantity": 1, "unit_price": 850000},
      {"description": "Channel manager integration", "quantity": 1, "unit_price": 250000},
      {"description": "Front-desk training", "quantity": 1, "unit_price": 100000}]');
  qt_dental := private.demo_doc(jsonb_build_object(
      'kind', 'quote', 'client_id', c_dental, 'lead_id', l_dental, 'owner_id', alex,
      'bill_to_name', 'Dr. Shanika Perera', 'bill_to_company', 'Kandy Lake Dental',
      'bill_to_email', 'shanika@kandylakedental.example', 'bill_to_address', 'Dalada Veediya, Kandy',
      'subject', 'Clinic website & online appointments', 'issue_date', today - 2, 'valid_until', today + 12,
      'created_by', alex, 'created_at', private.demo_at(today - 3, '16:45')),
    '[{"description": "Website — eight pages, Sinhala and English", "quantity": 1, "unit_price": 360000},
      {"description": "Online appointment booking", "quantity": 1, "unit_price": 120000},
      {"description": "Business listing and maps setup", "quantity": 1, "unit_price": 40000}]');

  -- ── invoices
  i_deposit := private.demo_doc(jsonb_build_object(
      'client_id', c_pepper, 'lead_id', l_pepper, 'owner_id', alex,
      'bill_to_name', 'Chaminda Bandara', 'bill_to_company', 'Ceylon Pepper Company',
      'bill_to_email', 'accounts@ceylonpepper.example', 'bill_to_address', 'Kandy Road, Matale',
      'subject', 'Online store — deposit', 'issue_date', today - 75, 'due_date', today - 61,
      'created_by', alex, 'created_at', private.demo_at(today - 75, '09:40')),
    '[{"description": "Online store build — 50% deposit", "details": "Custom store, 40 products, card payments, EU shipping", "quantity": 1, "unit_price": 475000}]');
  i_spice := private.demo_doc(jsonb_build_object(
      'client_id', c_spice, 'owner_id', nadia, 'currency', 'USD',
      'bill_to_name', 'Wei Ling Tan', 'bill_to_company', 'Spice Trail Travel',
      'bill_to_email', 'accounts@spicetrail.example', 'bill_to_address', 'Singapore',
      'subject', 'Landing pages & ad creative', 'issue_date', today - 38, 'due_date', today - 24,
      'payment_details', 'International wire · Flow State · Demo Bank PLC · SWIFT DEMOLKLX · Account 0000 1234 5678',
      'created_by', nadia, 'created_at', private.demo_at(today - 38, '11:00')),
    '[{"description": "Campaign landing pages", "quantity": 3, "unit_price": 450},
      {"description": "Ad creative set — 12 variations", "quantity": 1, "unit_price": 1050}]');
  -- Converted from the Ruhuna quote.
  i_ruhuna := private.demo_doc(jsonb_build_object(
      'client_id', c_ruhuna, 'lead_id', l_ruhuna, 'owner_id', nadia, 'source_quote_id', qt_ruhuna,
      'bill_to_name', 'Nimal Gunasekara', 'bill_to_company', 'Ruhuna Fresh Foods',
      'bill_to_email', 'nimal@ruhunafresh.example', 'bill_to_address', 'Beach Road, Matara',
      'subject', 'Brand refresh & packaging', 'issue_date', today - 45, 'due_date', today - 31,
      'discount_type', 'percent', 'discount_value', 5,
      'created_by', nadia, 'created_at', private.demo_at(today - 46, '10:15')),
    ruhuna_items);
  i_void := private.demo_doc(jsonb_build_object(
      'client_id', c_harbour, 'lead_id', l_harbour, 'owner_id', alex,
      'bill_to_name', 'Mohamed Rizwan', 'bill_to_company', 'Harbourline Logistics',
      'subject', 'Discovery workshop', 'issue_date', today - 30, 'due_date', today - 16,
      'created_by', alex, 'created_at', private.demo_at(today - 30, '16:00')),
    '[{"description": "Discovery workshop", "quantity": 1, "unit_price": 150000}]');
  i_workshop := private.demo_doc(jsonb_build_object(
      'client_id', c_harbour, 'lead_id', l_harbour, 'owner_id', alex,
      'bill_to_name', 'Mohamed Rizwan', 'bill_to_company', 'Harbourline Logistics',
      'bill_to_email', 'accounts@harbourline.example', 'bill_to_address', 'Port Access Road, Colombo 15',
      'subject', 'Discovery workshop', 'issue_date', today - 29, 'due_date', today - 15,
      'created_by', alex, 'created_at', private.demo_at(today - 29, '09:20')),
    '[{"description": "Discovery workshop — per day", "details": "Process mapping with ops and sales", "quantity": 2, "unit_price": 90000}]');
  i_final := private.demo_doc(jsonb_build_object(
      'client_id', c_pepper, 'lead_id', l_pepper, 'owner_id', alex,
      'bill_to_name', 'Chaminda Bandara', 'bill_to_company', 'Ceylon Pepper Company',
      'bill_to_email', 'accounts@ceylonpepper.example', 'bill_to_address', 'Kandy Road, Matale',
      'subject', 'Online store — launch', 'issue_date', today - 20, 'due_date', today - 6,
      'created_by', alex, 'created_at', private.demo_at(today - 20, '15:30')),
    '[{"description": "Online store build — final 50%", "quantity": 1, "unit_price": 475000}]');
  i_shoot := private.demo_doc(jsonb_build_object(
      'client_id', c_ruhuna, 'lead_id', l_ruhuna, 'owner_id', nadia,
      'bill_to_name', 'Nimal Gunasekara', 'bill_to_company', 'Ruhuna Fresh Foods',
      'bill_to_email', 'nimal@ruhunafresh.example', 'bill_to_address', 'Beach Road, Matara',
      'subject', 'Product photography', 'issue_date', today - 12, 'due_date', today + 2,
      'created_by', nadia, 'created_at', private.demo_at(today - 12, '14:10')),
    '[{"description": "Product photography — one day", "quantity": 1, "unit_price": 95000},
      {"description": "Retouching — per image", "quantity": 24, "unit_price": 2500}]');
  i_hosting := private.demo_doc(jsonb_build_object(
      'client_id', c_pepper, 'owner_id', nadia,
      'bill_to_name', 'Chaminda Bandara', 'bill_to_company', 'Ceylon Pepper Company',
      'bill_to_email', 'accounts@ceylonpepper.example', 'bill_to_address', 'Kandy Road, Matale',
      'subject', 'Hosting & domain', 'issue_date', today - 8, 'due_date', today + 6,
      'created_by', nadia, 'created_at', private.demo_at(today - 8, '10:05')),
    '[{"description": "Hosting & domain — 12 months", "quantity": 1, "unit_price": 96000}]');
  perform private.demo_doc(jsonb_build_object(
      'client_id', c_ruhuna, 'lead_id', l_ruhuna, 'owner_id', nadia,
      'bill_to_name', 'Nimal Gunasekara', 'bill_to_company', 'Ruhuna Fresh Foods',
      'bill_to_email', 'nimal@ruhunafresh.example',
      'subject', 'Packaging reprint artwork', 'issue_date', today, 'due_date', today + 14,
      'created_by', nadia, 'created_at', now() - interval '2 hours'),
    '[{"description": "Reprint artwork — per SKU", "quantity": 2, "unit_price": 32500}]');
  -- Over the invoice line and issued by a member: it waits for Alex, unnumbered.
  i_phase1 := private.demo_doc(jsonb_build_object(
      'status', 'pending_approval', 'client_id', c_harbour, 'lead_id', l_harbour, 'owner_id', nadia,
      'bill_to_name', 'Mohamed Rizwan', 'bill_to_company', 'Harbourline Logistics',
      'bill_to_email', 'accounts@harbourline.example', 'bill_to_address', 'Port Access Road, Colombo 15',
      'subject', 'Ops dashboard & CRM rollout — phase 1', 'issue_date', today, 'due_date', today + 14,
      'notes', '50% on sign-off, 50% on go-live.',
      'created_by', nadia, 'created_at', now() - interval '55 minutes'),
    '[{"description": "Discovery & solution design", "quantity": 1, "unit_price": 240000},
      {"description": "CRM setup & data migration", "quantity": 1, "unit_price": 380000},
      {"description": "Operations dashboard", "quantity": 1, "unit_price": 420000},
      {"description": "Team training — per session", "quantity": 2, "unit_price": 60000}]');
  -- The retainer's three runs so far.
  i_r1 := private.demo_doc((retainer - 'items') || jsonb_build_object(
      'schedule_id', s_retainer, 'period_start', p2, 'issue_date', p2, 'due_date', p2 + 14,
      'created_by', alex, 'created_at', private.demo_at(p2, '08:00')), retainer -> 'items');
  i_r2 := private.demo_doc((retainer - 'items') || jsonb_build_object(
      'schedule_id', s_retainer, 'period_start', p1, 'issue_date', p1, 'due_date', p1 + 14,
      'created_by', alex, 'created_at', private.demo_at(p1, '08:00')), retainer -> 'items');
  i_r3 := private.demo_doc((retainer - 'items') || jsonb_build_object(
      'schedule_id', s_retainer, 'period_start', m0, 'issue_date', m0, 'due_date', m0 + 14,
      'created_by', alex, 'created_at', private.demo_at(m0, '08:00')), retainer -> 'items');
  update public.invoice_schedules set last_invoice_id = i_r3 where id = s_retainer;

  -- Issue, answer, convert and void — trusted writes, so the stamps can be backdated.
  update public.invoices
  set status = 'issued',
      issued_at = private.demo_at(issue_date, case when schedule_id is null then '10:30'::time else '08:00'::time end)
  where id in (i_deposit, i_spice, i_ruhuna, i_void, i_workshop, i_final, i_shoot, i_hosting, i_r1, i_r2, i_r3);
  update public.invoices set status = 'void', voided_at = private.demo_at(today - 29, '09:05') where id = i_void;
  update public.invoices
  set status = 'converted', issued_at = private.demo_at(today - 52, '11:00'),
      accepted_at = private.demo_at(today - 47, '15:10'), converted_invoice_id = i_ruhuna
  where id = qt_ruhuna;
  update public.invoices
  set status = 'declined', issued_at = private.demo_at(today - 35, '10:00'), declined_at = private.demo_at(today - 25, '12:30')
  where id = qt_fitness;
  update public.invoices
  set status = 'accepted', issued_at = private.demo_at(today - 9, '10:00'), accepted_at = private.demo_at(today - 1, '18:20')
  where id = qt_lotus;
  update public.invoices set status = 'sent', issued_at = private.demo_at(today - 2, '09:30') where id = qt_dental;

  -- Numbers in the order things went out.
  update public.invoices i
  set number = 'INV-' || lpad(o.k::text, 4, '0')
  from (select id, row_number() over (order by issue_date, issued_at, id) as k
        from public.invoices
        where workspace = 'demo' and kind = 'invoice' and status not in ('draft', 'pending_approval')) o
  where i.id = o.id;
  get diagnostics n = row_count;
  update public.invoice_settings set next_invoice_number = n + 1 where workspace = 'demo';
  update public.invoices i
  set number = 'QT-' || lpad(o.k::text, 4, '0')
  from (select id, row_number() over (order by issued_at, id) as k
        from public.invoices
        where workspace = 'demo' and kind = 'quote' and status <> 'draft') o
  where i.id = o.id;
  get diagnostics n = row_count;
  update public.invoice_settings set next_quote_number = n + 1 where workspace = 'demo';

  -- Payments post their own LKR income; then each invoice settles once.
  insert into public.invoice_payments (invoice_id, amount, amount_base, paid_on, method, reference, note, created_by, created_at)
  values
    (i_deposit, 475000, 475000, today - 63, 'Bank transfer', null, null, nadia, private.demo_at(today - 63, '14:05')),
    (i_spice, 2400, 715200, today - 26, 'Wire transfer', null, 'USD 2,400 at 298.00', nadia, private.demo_at(today - 26, '10:40')),
    (i_ruhuna, 300000, 300000, today - 40, 'Bank transfer', null, 'Part payment — balance on delivery', nadia,
     private.demo_at(today - 40, '15:25')),
    (i_workshop, 180000, 180000, today - 17, 'Cheque', 'Chq 004512', null, nadia, private.demo_at(today - 17, '11:15')),
    (i_hosting, 96000, 96000, today - 3, 'Bank transfer', null, null, nadia, private.demo_at(today - 3, '09:50')),
    (i_r1, 185000, 185000, p2 + 9, 'Bank transfer', null, null, nadia, private.demo_at(p2 + 9, '12:00')),
    (i_r2, 185000, 185000, p1 + 12, 'Bank transfer', null, null, nadia, private.demo_at(p1 + 12, '12:00'));
  update public.invoices i
  set paid_at = (select private.demo_at(max(p.paid_on), '16:00') from public.invoice_payments p where p.invoice_id = i.id),
      updated_at = now()
  where i.id in (select p.invoice_id from public.invoice_payments p where p.workspace = 'demo');

  -- ── the ledger (approved unless it says otherwise)
  insert into public.finance_entries (workspace, kind, entry_date, description, category, amount, method, created_by, created_at)
  select 'demo', x.kind::public.finance_kind, x.day, x.description, x.category, x.amount, x.method, x.who,
         private.demo_at(x.day, '18:00')
  from (values
    ('expense', p2, 'Studio rent', 'Rent', 145000::numeric, 'Bank transfer', nadia),
    ('expense', p1, 'Studio rent', 'Rent', 145000, 'Bank transfer', nadia),
    ('expense', m0, 'Studio rent', 'Rent', 145000, 'Bank transfer', nadia),
    ('expense', p1 + 11, 'Electricity bill', 'Utilities', 18640, 'Online banking', nadia),
    ('expense', p1 + 3, 'Fibre internet', 'Utilities', 8990, 'Card', nadia),
    ('expense', p1 + 2, 'Design software licences', 'Software', 28400, 'Card', nadia),
    ('expense', p1 + 2, 'Email & docs suite', 'Software', 9800, 'Card', nadia),
    ('expense', greatest(m0, today - 6), 'Design software licences', 'Software', 28400, 'Card', nadia),
    ('expense', greatest(m0, today - 4), 'Prototyping tool — team plan', 'Software', 14200, 'Card', nadia),
    ('expense', greatest(m0, today - 2), 'Email & docs suite', 'Software', 9800, 'Card', nadia),
    ('expense', p1 + 9, 'Social ads — Lotus Bay case study', 'Marketing', 38000, 'Card', alex),
    ('expense', greatest(m0, today - 5), 'Social ads — studio showreel', 'Marketing', 45000, 'Card', alex),
    ('expense', greatest(m0, today - 1), 'Sponsored posts — Colombo SME week', 'Marketing', 17000, 'Card', alex),
    ('expense', greatest(m0, today - 7), 'Client visit — Matale (fuel & tolls)', 'Travel', 12500, 'Cash', nadia),
    ('expense', greatest(m0, today - 3), 'Train & tuk-tuk — Kandy client visit', 'Travel', 6000, 'Cash', nadia),
    ('expense', p1 + 17, 'Freelance motion designer — Lotus Bay reels', 'Contractors', 120000, 'Bank transfer', alex),
    ('expense', p2 + 19, 'Copywriter — Ceylon Pepper product pages', 'Contractors', 65000, 'Bank transfer', alex),
    ('expense', today - 2, 'Client lunch — Harbourline', 'Meals', 7800, 'Card', alex),
    ('expense', today - 26, 'Bank charges — incoming wire', 'Bank charges', 2350, 'Bank', nadia),
    ('expense', p1 + 7, 'Office supplies', 'Office', 6450, 'Cash', nadia),
    ('income', today - 14, 'Workshop — digital basics for small businesses', 'Workshops', 64000, 'Bank transfer', nadia)
  ) as x(kind, day, description, category, amount, method, who);

  -- Nadia's three asks over the expense line: one approved, one turned down, one waiting.
  insert into public.finance_entries (workspace, kind, entry_date, description, category, amount, method,
                                      approval_status, created_by, created_at)
  values ('demo', 'expense', greatest(q0, today - 10), '27-inch monitor for the design desk', 'Equipment', 89000, 'Card',
          'pending', nadia, private.demo_at(greatest(q0, today - 10), '11:00'))
  returning id into e_monitor;
  insert into public.finance_entries (workspace, kind, entry_date, description, category, amount, method,
                                      approval_status, created_by, created_at)
  values ('demo', 'expense', today - 8, 'Team offsite — venue deposit', 'Team', 85000, 'Bank transfer',
          'pending', nadia, private.demo_at(today - 8, '14:30'))
  returning id into e_offsite;
  insert into public.finance_entries (workspace, kind, entry_date, description, category, amount, method,
                                      approval_status, created_by, created_at)
  values ('demo', 'expense', greatest(q0, today - 1), 'Laptop for the new designer', 'Equipment', 412000, 'Card',
          'pending', nadia, private.demo_at(greatest(q0, today - 1), '11:40'))
  returning id into e_laptop;
  select id into ar_monitor from public.approval_requests where entity_type = 'expense' and entity_id = e_monitor and status = 'pending';
  select id into ar_offsite from public.approval_requests where entity_type = 'expense' and entity_id = e_offsite and status = 'pending';
  perform public.decide_approval(ar_monitor, 'approve');
  perform public.decide_approval(ar_offsite, 'reject', 'Let''s revisit after the quarter closes.');

  -- ── budgets (Software sits just past its alert line)
  insert into public.budgets (workspace, category, period, amount, alert_percent, created_by, created_at)
  values ('demo', 'Software', 'monthly', 60000, 80, alex, private.demo_at(p2, '09:00'))
  returning id into b_software;
  insert into public.budgets (workspace, category, period, amount, alert_percent, created_by, created_at) values
    ('demo', 'Marketing', 'monthly', 150000, 80, alex, private.demo_at(p2, '09:00')),
    ('demo', 'Travel', 'monthly', 40000, 80, alex, private.demo_at(p2, '09:00')),
    ('demo', 'Equipment', 'quarterly', 300000, 80, alex, private.demo_at(p2, '09:00'));

  -- ── time off: Kavin is out today, Maya's leave was approved, Kavin's next leave waits
  insert into public.time_off (workspace, user_id, type, starts_on, ends_on, half_day, note, status, decided_by, decided_at,
                               created_by, created_at)
  values
    ('demo', kavin, 'travel', today, today, null, 'Client visits in Galle', 'approved', alex,
     private.demo_at(today - 3, '10:05'), kavin, private.demo_at(today - 3, '09:40')),
    ('demo', nadia, 'sick', today - 4, today - 4, 'pm', null, 'approved', alex,
     private.demo_at(today - 4, '12:30'), nadia, private.demo_at(today - 4, '12:10'));
  insert into public.time_off (workspace, user_id, type, starts_on, ends_on, note, status, created_by, created_at)
  values ('demo', maya, 'annual', today + 7, today + 9, 'Family wedding in Kandy', 'pending', maya,
          private.demo_at(today - 3, '17:15'))
  returning id into t_maya;
  insert into public.time_off (workspace, user_id, type, starts_on, ends_on, note, status, created_by, created_at)
  values ('demo', kavin, 'annual', today + 16, today + 20, 'Trip to Ella', 'pending', kavin, now() - interval '5 hours')
  returning id into t_kavin;
  select id into ar_maya from public.approval_requests where entity_type = 'time_off' and entity_id = t_maya and status = 'pending';
  perform public.decide_approval(ar_maya, 'approve');
  update public.time_off set decided_at = private.demo_at(today - 2, '09:20') where id = t_maya;

  -- The asks, dated when they were made.
  select id into ar_laptop from public.approval_requests where entity_type = 'expense' and entity_id = e_laptop and status = 'pending';
  select id into ar_phase1 from public.approval_requests where entity_type = 'invoice' and entity_id = i_phase1 and status = 'pending';
  select id into ar_leave from public.approval_requests where entity_type = 'time_off' and entity_id = t_kavin and status = 'pending';
  update public.approval_requests a
  set created_at = x.asked, decided_at = x.decided
  from (values
    (ar_monitor, private.demo_at(greatest(q0, today - 10), '11:00'), private.demo_at(greatest(q0, today - 10), '15:45')),
    (ar_offsite, private.demo_at(today - 8, '14:30'), private.demo_at(today - 7, '10:10')),
    (ar_maya, private.demo_at(today - 3, '17:15'), private.demo_at(today - 2, '09:20')),
    (ar_laptop, private.demo_at(greatest(q0, today - 1), '11:40'), null::timestamptz),
    (ar_phase1, now() - interval '50 minutes', null),
    (ar_leave, now() - interval '5 hours', null)
  ) as x(id, asked, decided)
  where a.id = x.id;

  -- ── calendar
  insert into public.calendar_events (workspace, title, starts_at, ends_at, kind, location, created_by, created_at)
  values ('demo', 'Team stand-up', private.local_at(today, '09:30'), private.local_at(today, '09:45'), 'meeting',
          'Studio', alex, private.demo_at(today - 14, '09:00'))
  returning id into ev_standup;
  insert into public.calendar_events (workspace, title, description, starts_at, ends_at, kind, lead_id, client_id,
                                      meeting_url, created_by, created_at)
  values ('demo', 'Booking engine kickoff · Lotus Bay', 'Agree milestones and who on their side signs off.',
          private.local_at(today, '15:00'), private.local_at(today, '16:00'), 'meeting', l_lotus, c_lotus,
          'https://meet.example.com/lotus-kickoff', maya, private.demo_at(today - 1, '18:40'))
  returning id into ev_kickoff;
  insert into public.calendar_events (workspace, title, starts_at, ends_at, kind, lead_id, client_id, created_by, created_at)
  values ('demo', 'Call Harbourline — phase 1 sign-off', private.local_at(today + 1, '11:00'),
          private.local_at(today + 1, '11:30'), 'follow_up', l_harbour, c_harbour, alex, private.demo_at(today - 2, '11:45'))
  returning id into ev_harbour;
  insert into public.calendar_events (workspace, title, starts_at, all_day, kind, client_id, location, created_by, created_at)
  values ('demo', 'Product shoot · Ruhuna Fresh Foods', private.local_at(today + 2, '00:00'), true, 'task', c_ruhuna,
          'Ruhuna Fresh Foods, Matara', maya, private.demo_at(today - 6, '10:00'))
  returning id into ev_shoot;
  insert into public.calendar_events (workspace, title, starts_at, ends_at, kind, lead_id, client_id, location,
                                      created_by, created_at)
  values ('demo', 'Proposal walkthrough · Kandy Lake Dental', private.local_at(today + 3, '14:00'),
          private.local_at(today + 3, '15:00'), 'meeting', l_dental, c_dental, 'Kandy Lake Dental, Kandy', kavin,
          private.demo_at(today - 2, '17:10'))
  returning id into ev_dental;
  insert into public.calendar_events (workspace, title, starts_at, ends_at, kind, location, created_by, created_at)
  values ('demo', 'Monthly finance review', private.local_at(today + 5, '10:00'), private.local_at(today + 5, '11:00'),
          'meeting', 'Studio', nadia, private.demo_at(today - 4, '09:10'))
  returning id into ev_finance;
  insert into public.calendar_events (workspace, title, starts_at, ends_at, kind, lead_id, client_id, meeting_url,
                                      created_by, created_at)
  values ('demo', 'Launch check-in · Ceylon Pepper', private.local_at(today + 8, '11:00'),
          private.local_at(today + 8, '11:45'), 'meeting', l_pepper, c_pepper, 'https://meet.example.com/pepper-launch',
          kavin, private.demo_at(today - 1, '12:00'))
  returning id into ev_pepper;
  insert into public.calendar_events (workspace, title, starts_at, ends_at, kind, done, lead_id, created_by, created_at)
  values ('demo', 'Proposal review · Jaffna Silk House', private.local_at(today - 1, '16:00'),
          private.local_at(today - 1, '16:45'), 'meeting', true, l_silk, kavin, private.demo_at(today - 5, '10:30'))
  returning id into ev_silk;
  insert into public.calendar_events (workspace, title, description, starts_at, all_day, kind, created_by, created_at)
  values ('demo', 'EPF / ETF payment due', 'Contributions for last month.', private.local_at(today + 9, '00:00'), true,
          'payment', nadia, private.demo_at(today - 20, '09:00'));
  insert into public.calendar_events (workspace, title, starts_at, all_day, kind, done, client_id, created_by, created_at)
  values ('demo', 'Send Lotus Bay monthly report', private.local_at(today - 6, '00:00'), true, 'task', true, c_lotus, maya,
          private.demo_at(today - 12, '15:00'));
  insert into public.calendar_events (workspace, title, starts_at, ends_at, kind, lead_id, location, created_by, created_at)
  values ('demo', 'Design review · Ella Eco Lodge concepts', private.local_at(today + 4, '15:30'),
          private.local_at(today + 4, '16:30'), 'meeting', l_ella, 'Studio', maya, private.demo_at(today - 1, '10:00'))
  returning id into ev_ella;

  insert into public.calendar_event_attendees (event_id, user_id, added_by, created_at) values
    (ev_standup, maya, alex, private.demo_at(today - 14, '09:00')),
    (ev_standup, kavin, alex, private.demo_at(today - 14, '09:00')),
    (ev_standup, nadia, alex, private.demo_at(today - 14, '09:00')),
    (ev_kickoff, alex, maya, private.demo_at(today - 1, '18:40')),
    (ev_harbour, kavin, alex, private.demo_at(today - 2, '11:45')),
    (ev_shoot, kavin, maya, private.demo_at(today - 6, '10:00')),
    (ev_dental, alex, kavin, private.demo_at(today - 2, '17:10')),
    (ev_finance, alex, nadia, private.demo_at(today - 4, '09:10')),
    (ev_pepper, maya, kavin, private.demo_at(today - 1, '12:00')),
    (ev_pepper, alex, kavin, private.demo_at(today - 1, '12:00')),
    (ev_silk, alex, kavin, private.demo_at(today - 5, '10:30')),
    (ev_ella, alex, maya, private.demo_at(today - 1, '10:00')),
    (ev_ella, kavin, maya, private.demo_at(today - 1, '10:00'));

  -- ── to-dos
  insert into public.todos (workspace, title, notes, priority, due_at, remind_at, labels, lead_id, client_id, position,
                            created_by, created_at)
  values ('demo', 'Send Lotus Bay the booking engine timeline', 'Milestones from the accepted quote; deposit first.',
          'high', private.local_at(today, '17:00'), private.local_at(today, '15:00'), '{lotus-bay}', l_lotus, c_lotus, 0,
          alex, private.demo_at(today - 1, '18:50'))
  returning id into td_timeline;
  insert into public.todos (workspace, title, priority, due_at, all_day, labels, invoice_id, client_id, position,
                            created_by, created_at)
  values ('demo', 'Chase the Ruhuna Fresh Foods balance', 'urgent', private.local_at(today, '00:00'), true, '{finance}',
          i_ruhuna, c_ruhuna, 1, alex, private.demo_at(today - 2, '09:00'))
  returning id into td_chase;
  insert into public.todos (workspace, title, notes, priority, due_at, labels, lead_id, client_id, position,
                            created_by, created_at)
  values ('demo', 'Prepare the Harbourline phase 1 SOW', 'Scope, timeline, pricing and payment milestones.', 'high',
          private.local_at(today + 2, '12:00'), '{sales}', l_harbour, c_harbour, 2, alex, private.demo_at(today - 2, '12:10'))
  returning id into td_sow;
  insert into public.todos (workspace, title, priority, due_at, all_day, remind_at, labels, position, created_by, created_at)
  values ('demo', 'Renew design software licences', 'normal', private.local_at(today + 5, '00:00'), true,
          private.local_at(today + 4, '09:00'), '{finance}', 3, nadia, private.demo_at(today - 6, '10:00'))
  returning id into td_licences;
  insert into public.todos (workspace, title, status, priority, due_at, all_day, client_id, position, completed_at,
                            completed_by, created_by, created_at)
  values ('demo', 'Book a photographer for the Ruhuna shoot', 'done', 'normal', private.local_at(today - 1, '00:00'), true,
          c_ruhuna, 4, private.demo_at(today - 1, '17:20'), maya, alex, private.demo_at(today - 7, '11:00'))
  returning id into td_photographer;
  insert into public.todos (workspace, title, priority, due_at, recurrence, labels, client_id, position, created_by, created_at)
  values ('demo', 'Plan next week''s Lotus Bay posts', 'normal', private.local_at(today + 3, '16:00'), 'weekly',
          '{lotus-bay,social}', c_lotus, 5, maya, private.demo_at(today - 30, '10:00'))
  returning id into td_posts;
  insert into public.todos (workspace, title, priority, due_at, all_day, lead_id, position, created_by, created_at)
  values ('demo', 'Follow up with Tharu Batiks', 'low', private.local_at(today + 6, '00:00'), true, l_batik, 6, maya,
          private.demo_at(today - 9, '15:00'))
  returning id into td_batik;
  insert into public.todos (workspace, title, priority, due_at, all_day, labels, position, created_by, created_at)
  values ('demo', 'Review this month''s budgets', 'normal', private.local_at(today + 3, '00:00'), true, '{finance}', 7,
          nadia, private.demo_at(today - 1, '09:30'))
  returning id into td_budgets;
  insert into public.todos (workspace, title, kind, priority, due_at, remind_at, lead_id, position, created_by, created_at)
  values ('demo', 'Call Dr. Shanika about the proposal', 'reminder', 'normal', private.local_at(today + 1, '10:00'),
          private.local_at(today + 1, '09:30'), l_dental, 8, kavin, private.demo_at(today - 2, '17:20'))
  returning id into td_dental;
  insert into public.todos (workspace, title, notes, priority, client_id, position, created_by, created_at)
  values ('demo', 'Write the Ceylon Pepper case study', 'Before/after numbers once the store has a month of sales.',
          'low', c_pepper, 9, alex, private.demo_at(today - 4, '16:00'))
  returning id into td_casestudy;
  insert into public.todos (workspace, title, priority, due_at, all_day, is_private, position, created_by, created_at)
  values ('demo', 'Salary reviews — prepare notes', 'high', private.local_at(today + 10, '00:00'), true, true, 10, alex,
          private.demo_at(today - 3, '20:00'));
  insert into public.todos (workspace, title, kind, status, priority, due_at, all_day, remind_at, labels, position,
                            created_by, created_at)
  values ('demo', 'Pay EPF / ETF contributions', 'reminder', 'in_progress', 'high', private.local_at(today + 9, '00:00'),
          true, private.local_at(today + 8, '09:00'), '{finance}', 11, nadia, private.demo_at(today - 20, '09:05'))
  returning id into td_epf;
  insert into public.todos (workspace, title, priority, due_at, all_day, lead_id, client_id, position, created_by, created_at)
  values ('demo', 'Send the signed contract to Ceylon Pepper', 'high', private.local_at(today - 2, '00:00'), true,
          l_pepper, c_pepper, 12, alex, private.demo_at(today - 8, '10:00'))
  returning id into td_contract;
  insert into public.todos (workspace, title, priority, due_at, client_id, position, created_by, created_at)
  values ('demo', 'Approve the Lotus Bay homepage mockups', 'high', private.local_at(today + 1, '12:00'), c_lotus, 13,
          maya, now() - interval '4 hours')
  returning id into td_mockups;

  insert into public.todo_assignees (todo_id, user_id, assigned_by, created_at) values
    (td_timeline, maya, alex, private.demo_at(today - 1, '18:50')),
    (td_chase, nadia, alex, private.demo_at(today - 2, '09:00')),
    (td_sow, kavin, alex, private.demo_at(today - 2, '12:10')),
    (td_sow, maya, alex, private.demo_at(today - 2, '12:10')),
    (td_licences, nadia, nadia, private.demo_at(today - 6, '10:00')),
    (td_photographer, maya, alex, private.demo_at(today - 7, '11:00')),
    (td_posts, maya, maya, private.demo_at(today - 30, '10:00')),
    (td_batik, kavin, maya, private.demo_at(today - 9, '15:00')),
    (td_budgets, nadia, nadia, private.demo_at(today - 1, '09:30')),
    (td_budgets, alex, nadia, private.demo_at(today - 1, '09:30')),
    (td_dental, kavin, kavin, private.demo_at(today - 2, '17:20')),
    (td_casestudy, maya, alex, private.demo_at(today - 4, '16:00')),
    (td_epf, nadia, nadia, private.demo_at(today - 20, '09:05')),
    (td_contract, kavin, alex, private.demo_at(today - 8, '10:00')),
    (td_mockups, alex, maya, now() - interval '4 hours');

  insert into public.todo_checklist (todo_id, body, done, position) values
    (td_timeline, 'Draft milestones from the quote', true, 0),
    (td_timeline, 'Confirm channel-manager API access', false, 1),
    (td_timeline, 'Send to Dinesh', false, 2),
    (td_sow, 'Scope & deliverables', true, 0),
    (td_sow, 'Timeline', true, 1),
    (td_sow, 'Pricing table', false, 2),
    (td_sow, 'Payment milestones', false, 3),
    (td_licences, 'Count active seats', true, 0),
    (td_licences, 'Renew on the company card', false, 1),
    (td_mockups, 'Desktop homepage', false, 0),
    (td_mockups, 'Mobile homepage', false, 1);

  -- ── comments, with mentions on a to-do, a lead and an invoice
  insert into public.comments (todo_id, author_id, body, mentions, created_at)
  values (td_chase, nadia,
          format('@%s they''ve paid Rs 300,000 and promised the balance by Friday. Shall I send a reminder anyway?', n_alex),
          array[alex], now() - interval '3 hours')
  returning id into cm_chase;
  insert into public.comments (todo_id, author_id, body, mentions, created_at)
  values (td_sow, maya,
          format('@%s the timeline section is in. Can you add the pricing table before Thursday?', n_kavin),
          array[kavin], private.demo_at(today - 1, '14:20'));
  insert into public.comments (lead_id, author_id, body, mentions, created_at)
  values (l_harbour, kavin,
          format('@%s Rizwan confirmed the phase 1 budget on the call. They want the dashboard live before the January peak.', n_alex),
          array[alex], private.demo_at(today - 2, '11:50'))
  returning id into cm_harbour;
  insert into public.comments (invoice_id, author_id, body, mentions, created_at)
  values (i_ruhuna, nadia,
          format('@%s Rs 300,000 is in. The balance is promised once the last two packaging files are delivered.', n_alex),
          array[alex], private.demo_at(today - 6, '10:30'))
  returning id into cm_ruhuna;
  insert into public.comments (todo_id, author_id, body, created_at)
  values (td_timeline, alex, 'Keep the channel-manager step separate — their team still has to send the API keys.',
          private.demo_at(today - 1, '19:00'));
  insert into public.comments (client_id, author_id, body, created_at)
  values (c_lotus, maya, 'Dinesh asked for the monthly report on the 5th instead of the 1st, from next month.',
          private.demo_at(today - 5, '16:40'));
  insert into public.comments (invoice_id, author_id, body, created_at)
  values (i_phase1, nadia, 'Phase 1 as agreed on the call. It''s over the approval line, so it''s with you.',
          now() - interval '50 minutes');

  -- ── the bell: reminders still ahead are scheduled the normal way
  perform set_config('flowstate.seeding', coalesce(prev_seed, ''), true);
  for r in select id from public.calendar_events where workspace = 'demo' loop
    perform private.reschedule_event_reminders(r.id);
  end loop;
  for r in select id from public.todos where workspace = 'demo' loop
    perform private.reschedule_todo_reminder(r.id);
  end loop;
  -- Same alert as 0013's schedule_invoice_overdue, for every open invoice.
  for r in
    select * from public.invoices
    where workspace = 'demo' and kind = 'invoice' and status in ('issued', 'partially_paid') and due_date is not null
  loop
    perform private.notify(
      array(select u from private.users_with_access('invoices', 'demo') u where u = r.owner_id),
      'demo',
      'invoice_overdue',
      format('%s is overdue', coalesce(r.number, 'An invoice')),
      concat_ws(' · ',
        coalesce(nullif(btrim(r.bill_to_company), ''), nullif(btrim(r.bill_to_name), '')),
        'was due ' || to_char(r.due_date, 'FMDD Mon YYYY')
      ),
      '/admin/invoices/' || r.id,
      'invoice', r.id,
      private.local_at(r.due_date + 1, '09:00'),
      null
    );
  end loop;
  perform set_config('flowstate.seeding', 'on', true);

  -- …and the rest of the inbox is written by hand: what the demo login would
  -- have heard about this past week, the newest still unread.
  insert into public.notifications (workspace, recipient_id, actor_id, type, title, body, link, entity_type, entity_id,
                                    deliver_at, read_at, created_at)
  select 'demo', alex, x.actor, x.type, x.title, x.body, x.link, x.entity_type, x.entity_id, x.at,
         case when x.seen then least(x.at + interval '25 minutes', now()) end, x.at
  from (
    select null::uuid as actor, null::text as type, null::text as title, null::text as body, null::text as link,
           null::text as entity_type, null::uuid as entity_id, null::timestamptz as at, null::boolean as seen
    where false
    union all
    select nadia, 'approval_requested',
           format('Expense needs approval · %s', a.summary), concat_ws(' · ', n_nadia, private.money(a.amount, a.currency)),
           '/admin/approvals?open=' || a.id, 'approval', a.id, a.created_at, false
    from public.approval_requests a where a.id = ar_laptop
    union all
    select nadia, 'approval_requested',
           format('Invoice needs approval · %s', a.summary), concat_ws(' · ', n_nadia, private.money(a.amount, a.currency)),
           '/admin/approvals?open=' || a.id, 'approval', a.id, a.created_at, false
    from public.approval_requests a where a.id = ar_phase1
    union all
    select kavin, 'approval_requested', format('Time off needs approval · %s', a.summary), n_kavin,
           '/admin/approvals?open=' || a.id, 'approval', a.id, a.created_at, false
    from public.approval_requests a where a.id = ar_leave
    union all
    select c.author_id, 'mention', format('%s mentioned you · %s', n_nadia, td.title), c.body,
           '/admin/todos?open=' || td.id, 'comment', c.id, c.created_at, false
    from public.comments c join public.todos td on td.id = c.todo_id where c.id = cm_chase
    union all
    select c.author_id, 'mention', format('%s mentioned you · %s', n_kavin, l.company), c.body,
           '/admin/crm?lead=' || l.id, 'comment', c.id, c.created_at, false
    from public.comments c join public.leads l on l.id = c.lead_id where c.id = cm_harbour
    union all
    select c.author_id, 'mention', format('%s mentioned you · %s', n_nadia, i.number), c.body,
           '/admin/invoices/' || i.id || '?tab=comments', 'comment', c.id, c.created_at, true
    from public.comments c join public.invoices i on i.id = c.invoice_id where c.id = cm_ruhuna
    union all
    select null, 'inquiry_new', format('New inquiry from %s', q.name), concat_ws(' · ', q.business, q.focus),
           '/admin/inquiries?open=' || q.id, 'inquiry', q.id, q.created_at, q.id = q_learning
    from public.inquiries q where q.id in (q_hardware, q_learning)
    union all
    select nadia, 'quote_accepted', format('Quote accepted · %s', i.number),
           concat_ws(' · ', i.bill_to_company, private.money(i.total, i.currency)),
           '/admin/invoices/' || i.id, 'invoice', i.id, i.accepted_at, false
    from public.invoices i where i.id = qt_lotus
    union all
    select maya, 'todo_assigned', format('To-do for you · %s', td.title),
           concat_ws(' · ', 'Due ' || private.local_when(td.due_at, td.all_day), 'High priority'),
           '/admin/todos?open=' || td.id, 'todo', td.id, td.created_at, false
    from public.todos td where td.id = td_mockups
    union all
    select nadia, 'todo_assigned', format('To-do for you · %s', td.title), 'Due ' || private.local_when(td.due_at, td.all_day),
           '/admin/todos?open=' || td.id, 'todo', td.id, td.created_at, true
    from public.todos td where td.id = td_budgets
    union all
    select maya, 'todo_completed', format('Done · %s', td.title), 'Completed by ' || n_maya,
           '/admin/todos?open=' || td.id, 'todo', td.id, td.completed_at, true
    from public.todos td where td.id = td_photographer
    union all
    select null, 'budget_alert', format('Budget at %s%% · %s', floor(s.spent * 100 / s.amount)::integer, s.category),
           format('%s of %s spent · %s', private.rupees(s.spent), private.rupees(s.amount), to_char(s.period_start, 'FMMonth YYYY')),
           '/admin/expenses/budgets', 'budget', s.id, private.demo_at(greatest(m0, today - 2), '18:05'), false
    from public.budget_status s where s.id = b_software and s.spent * 100 >= s.amount * s.alert_percent
    union all
    select nadia, 'invoice_paid', format('%s paid in full', i.number),
           concat_ws(' · ', i.bill_to_company, private.money(i.total, i.currency) || ' received'),
           '/admin/invoices/' || i.id, 'invoice', i.id, i.paid_at, true
    from public.invoices i where i.id = i_hosting
    union all
    select nadia, 'payment_recorded', format('Payment received · %s', i.number),
           concat_ws(' · ', i.bill_to_company, private.money(300000, i.currency) || ' received',
                     private.money(i.balance_due, i.currency) || ' left to pay'),
           '/admin/invoices/' || i.id, 'invoice', i.id, private.demo_at(today - 40, '15:25'), true
    from public.invoices i where i.id = i_ruhuna
    union all
    select maya, 'event_invite', format('You''re invited · %s', e.title), private.local_when(e.starts_at, e.all_day),
           '/admin/calendar?event=' || e.id, 'event', e.id, private.demo_at(today - 1, '18:40'), true
    from public.calendar_events e where e.id = ev_kickoff
    union all
    select null, 'recurring_generated', format('%s issued · %s', i.number, s.name),
           concat_ws(' · ', i.bill_to_company, private.money(i.total, i.currency), 'for ' || to_char(i.period_start, 'FMDD Mon YYYY')),
           '/admin/invoices/' || i.id, 'invoice', i.id, i.issued_at, true
    from public.invoices i join public.invoice_schedules s on s.id = i.schedule_id where i.id = i_r3
    union all
    select kavin, 'lead_won', format('Deal won · %s', l.company), private.rupees(l.value),
           '/admin/crm?lead=' || l.id, 'lead', l.id, private.demo_at(today - 76, '17:00'), true
    from public.leads l where l.id = l_pepper
  ) as x;

  -- A few lines for Team → Activity, in the words the triggers use.
  insert into public.activity_log (workspace, actor_id, action, entity_type, entity_id, entity_label, summary, changes, created_at)
  select 'demo', x.actor, x.action, x.entity_type, x.entity_id, x.label, x.summary, x.changes, x.at
  from (
    select null::uuid as actor, null::text as action, null::text as entity_type, null::uuid as entity_id,
           null::text as label, null::text as summary, null::jsonb as changes, null::timestamptz as at
    where false
    union all
    select nadia, 'payment_recorded', 'invoice', i.id, i.number,
           format('recorded a payment of %s on %s', private.money(300000, i.currency), i.number), null, private.demo_at(today - 40, '15:25')
    from public.invoices i where i.id = i_ruhuna
    union all
    select alex, 'updated', 'invoice', i.id, i.number, format('updated invoice “%s” · status', i.number),
           jsonb_build_object('status', jsonb_build_object('from', 'issued', 'to', 'void')), i.voided_at
    from public.invoices i where i.id = i_void
    union all
    select kavin, 'updated', 'lead', l.id, l.name, format('updated lead “%s” · value', l.name),
           jsonb_build_object('value', jsonb_build_object('from', 1800000, 'to', l.value)), private.demo_at(today - 2, '11:45')
    from public.leads l where l.id = l_harbour
    union all
    select kavin, 'created', 'lead', l.id, l.name, format('created lead “%s”', l.name), null, l.created_at
    from public.leads l where l.id in (l_ella, l_bake)
    union all
    select alex, 'created', 'client', c.id, c.name, format('created client “%s”', c.name), null, c.created_at
    from public.clients c where c.id = c_harbour
    union all
    select alex, 'approved', 'time_off', t.id, concat_ws(' · ', n_maya, private.time_off_label(t.type) || ' · ' || private.day_span(t.starts_on, t.ends_on, t.half_day)),
           format('approved time off for %s · %s', n_maya, private.time_off_label(t.type) || ' · ' || private.day_span(t.starts_on, t.ends_on, t.half_day)),
           jsonb_build_object('status', jsonb_build_object('from', 'pending', 'to', 'approved')), t.decided_at
    from public.time_off t where t.id = t_maya
    union all
    select nadia, 'created', 'entry', f.id, f.description, format('created entry “%s”', f.description), null, f.created_at
    from public.finance_entries f where f.id = e_laptop
    union all
    select maya, 'assigned', 'todo', td.id, td.title, format('assigned %s to “%s”', n_kavin, td.title), null,
           private.demo_at(today - 2, '12:15')
    from public.todos td where td.id = td_sow
    union all
    select maya, 'commented', 'client', c.id, c.name, format('commented on client “%s”', c.name), null,
           private.demo_at(today - 5, '16:40')
    from public.clients c where c.id = c_lotus
  ) as x;

  update public.workspaces set demo_reset_at = now() where id = 'demo';

  -- ── nothing live carries this reset's xid
  for r in
    select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'workspace' and not a.attisdropped)
  loop
    execute format('select count(*) from public.%I where workspace = %L and xmin = $1', r.relname, 'live')
      into n using v_xid;
    if n > 0 then
      raise exception 'The demo reset would have changed % live row(s) in %, so it was rolled back.', n, r.relname
        using errcode = 'P0001';
    end if;
  end loop;
  if exists (select 1 from public.workspaces where id = 'live' and xmin = v_xid) then
    raise exception 'The demo reset would have changed the live workspace, so it was rolled back.' using errcode = 'P0001';
  end if;

  perform set_config('request.jwt.claims', coalesce(prev_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(prev_sub, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(prev_role, ''), true);
  perform set_config('flowstate.seeding', coalesce(prev_seed, ''), true);
  perform set_config('flowstate.invoice_batch', coalesce(prev_batch, ''), true);
end;
$$;

revoke execute on function private.seed_demo_workspace(uuid, uuid[]) from public, anon, authenticated;

-- ───────────────────────────── entry points ────────────────────────────────
-- The service role only (Team → Demo, the sign-in heal), or a direct session
-- as the database owner (SQL editor). EXECUTE is granted to service_role
-- alone; the check below also catches a stray grant, or a service-role
-- connection carrying someone's user token.
create or replace function public.reset_demo_workspace(p_demo uuid, p_team uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not ((current_setting('role', true) = 'service_role' and coalesce(auth.role(), '') = 'service_role')
          or coalesce(current_setting('role', true), 'none') in ('none', 'postgres')) then
    raise exception 'Only the service role can reset the demo.' using errcode = '42501';
  end if;
  perform private.seed_demo_workspace(p_demo, p_team);
end;
$$;

revoke execute on function public.reset_demo_workspace(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reset_demo_workspace(uuid, uuid[]) to service_role;

-- For pg_cron: the accounts are found by app_metadata.demo_key (which only
-- the service role can write), keys as in DEMO_TEAM. No demo account yet →
-- nothing to do.
create or replace function private.reset_demo_data()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demo uuid;
  v_team uuid[];
begin
  select u.id into v_demo
  from auth.users u join public.profiles p on p.id = u.id and p.workspace = 'demo'
  where u.raw_app_meta_data ->> 'demo_key' = 'primary'
  order by u.created_at
  limit 1;
  v_team := array(
    select (select u.id from auth.users u join public.profiles p on p.id = u.id and p.workspace = 'demo'
            where u.raw_app_meta_data ->> 'demo_key' = k.key
            order by u.created_at limit 1)
    from unnest(array['maya', 'kavin', 'nadia']) with ordinality as k(key, ord)
    order by k.ord
  );
  if v_demo is null or array_position(v_team, null) is not null then
    raise notice 'No demo account yet — create it from Team → Demo. Nothing was reset.';
    return false;
  end if;
  perform private.seed_demo_workspace(v_demo, v_team);
  return true;
end;
$$;

revoke execute on function private.reset_demo_data() from public, anon, authenticated;

-- ─────────────────────────────── pg_cron ───────────────────────────────────
-- 21:30 UTC = 03:00 in Colombo. Projects without pg_cron (and the local
-- harness) skip this quietly; the sign-in heal still reseeds stale data.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    null;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('flowstate-demo-reset', '30 21 * * *', 'select private.reset_demo_data()');
  end if;
exception when others then
  raise notice 'flowstate-demo-reset not scheduled: %', sqlerrm;
end $$;
