-- ============================================================================
-- 0026 · Legacy import
-- The business moves to a new Supabase project; its history comes with it.
-- scripts/import-legacy.mjs reads the old project's 0001–0006 tables through
-- REST (raw `select *` rows: no workspace column, none of the columns added
-- since) and hands them to import_legacy_data(payload) in one call:
--
--   { stages, inquiries, leads, lead_activities, finance_entries,
--     calendar_events, email_states,           -- arrays of old rows
--     user_map: { old_user_id: new_user_id },  -- matched by email
--     fallback_user: uuid }                    -- the new super admin
--
-- One transaction, all into the live workspace, with flowstate.importing on:
-- no alerts, no activity lines and no auto-written lead trail (the old trail
-- is copied as it was). Rows keep their ids and every insert is
-- `on conflict do nothing`, so a second run copies nothing twice. Columns are
-- listed one by one with defaults for anything the old row lacks — a stray
-- key in the payload never reaches a column it shouldn't.
--
-- Pipeline stages are matched by slug to the board 0003 seeded: a default the
-- old project also had is updated in place (name, tone, order, won/lost —
-- the protected first stage keeps its name and place), anything else is
-- inserted, and leads follow their stage to its id in the new project.
-- Inquiries go in before the leads made from them, then get their link back.
-- People are mapped through user_map to live accounts; an author with no
-- account here (or mapped to anyone outside live) is credited to
-- fallback_user. Every lead gets an owner: its creator, or fallback_user.
-- Ledger rows arrive approved — the old ledger had no approvals.
--
-- service_role only, like reset_demo_workspace (0025). Returns how many rows
-- each table gained.
-- Requires: 0025
-- ============================================================================

-- An old user id → a live account here: user_map's answer if that's a live
-- profile, otherwise the fallback. No author stays no author.
create or replace function private.legacy_user(p_map jsonb, p_old text, p_fallback uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when nullif(p_old, '') is null then null
    else coalesce(
      (select p.id from public.profiles p
       where p.workspace = 'live'
         and p.id = case when p_map ->> p_old ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         then (p_map ->> p_old)::uuid end),
      p_fallback)
  end;
$$;

revoke execute on function private.legacy_user(jsonb, text, uuid) from public, anon, authenticated;

create or replace function public.import_legacy_data(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  users       jsonb;
  fallback    uuid;
  stage_map   jsonb := '{}'::jsonb;
  first_stage uuid;
  prev_import text := current_setting('flowstate.importing', true);
  r           jsonb;
  st          public.pipeline_stages;
  v_slug      text;
  v_old       uuid;
  n           bigint;
  n_stages    bigint := 0;
  n_inquiries bigint;
  n_leads     bigint;
  n_trail     bigint;
  n_ledger    bigint;
  n_events    bigint;
  n_mail      bigint;
begin
  if not ((current_setting('role', true) = 'service_role' and coalesce(auth.role(), '') = 'service_role')
          or coalesce(current_setting('role', true), 'none') in ('none', 'postgres')) then
    raise exception 'Only the service role can import legacy data.' using errcode = '42501';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'Nothing to import.' using errcode = '22023';
  end if;

  users := case when jsonb_typeof(payload -> 'user_map') = 'object' then payload -> 'user_map' else '{}'::jsonb end;
  if coalesce(payload ->> 'fallback_user', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'fallback_user must be the new super admin''s id.' using errcode = '22023';
  end if;
  fallback := (payload ->> 'fallback_user')::uuid;
  if not exists (select 1 from public.profiles p where p.id = fallback and p.workspace = 'live' and p.is_active
                 and p.role in ('super_admin', 'admin', 'member')) then
    raise exception 'fallback_user must be an active live account (the super admin).' using errcode = '22023';
  end if;

  perform set_config('flowstate.importing', 'on', true);

  -- ── stages: a default matched by slug is updated, anything else is added
  for r in
    select e from jsonb_array_elements(coalesce(payload -> 'stages', '[]'::jsonb)) as e
    order by coalesce((e ->> 'position')::integer, 0)
  loop
    v_old := (r ->> 'id')::uuid;
    v_slug := nullif(btrim(r ->> 'slug'), '');
    st := null;
    if v_slug is not null then
      select * into st from public.pipeline_stages where workspace = 'live' and slug = v_slug;
    end if;

    if st.id is not null then
      if st.is_protected then
        -- 0003's guard keeps its name and first place.
        update public.pipeline_stages
        set tone = coalesce(nullif(r ->> 'tone', ''), tone)
        where id = st.id and tone is distinct from coalesce(nullif(r ->> 'tone', ''), tone);
      else
        update public.pipeline_stages
        set name = coalesce(nullif(btrim(r ->> 'name'), ''), name),
            tone = coalesce(nullif(r ->> 'tone', ''), tone),
            position = coalesce((r ->> 'position')::integer, position),
            is_won = coalesce((r ->> 'is_won')::boolean, is_won),
            is_lost = coalesce((r ->> 'is_lost')::boolean, is_lost)
        where id = st.id
          and (name, tone, position, is_won, is_lost) is distinct from (
            coalesce(nullif(btrim(r ->> 'name'), ''), name), coalesce(nullif(r ->> 'tone', ''), tone),
            coalesce((r ->> 'position')::integer, position), coalesce((r ->> 'is_won')::boolean, is_won),
            coalesce((r ->> 'is_lost')::boolean, is_lost));
      end if;
      stage_map := stage_map || jsonb_build_object(v_old::text, st.id);
    else
      -- Only the board's first stage is protected; an imported one never is.
      insert into public.pipeline_stages (id, workspace, name, slug, position, tone, is_protected, is_won, is_lost,
                                          created_at, updated_at)
      values (
        v_old, 'live', coalesce(nullif(btrim(r ->> 'name'), ''), 'Stage'), v_slug,
        coalesce((r ->> 'position')::integer, 0), coalesce(nullif(r ->> 'tone', ''), 'cream'), false,
        coalesce((r ->> 'is_won')::boolean, false), coalesce((r ->> 'is_lost')::boolean, false),
        coalesce((r ->> 'created_at')::timestamptz, now()),
        coalesce((r ->> 'updated_at')::timestamptz, (r ->> 'created_at')::timestamptz, now())
      )
      on conflict (id) do nothing;
      get diagnostics n = row_count;
      n_stages := n_stages + n;
      -- Added now or by an earlier run: the id is the old one either way.
      if exists (select 1 from public.pipeline_stages where id = v_old and workspace = 'live') then
        stage_map := stage_map || jsonb_build_object(v_old::text, v_old);
      end if;
    end if;
  end loop;

  -- Leads whose stage didn't come across land in the first column.
  select id into first_stage from public.pipeline_stages
  where workspace = 'live'
  order by is_protected desc, position, created_at
  limit 1;

  -- ── inquiries (their lead link comes back once the leads exist)
  insert into public.inquiries (id, workspace, name, business, contact, focus, message, source, page, status,
                                notes, created_at, updated_at)
  select (e ->> 'id')::uuid, 'live', coalesce(nullif(btrim(e ->> 'name'), ''), 'Unknown'), e ->> 'business',
         coalesce(e ->> 'contact', ''), e ->> 'focus', e ->> 'message', coalesce(nullif(e ->> 'source', ''), 'website'),
         e ->> 'page', coalesce(nullif(e ->> 'status', ''), 'new')::public.inquiry_status, e ->> 'notes',
         coalesce((e ->> 'created_at')::timestamptz, now()),
         coalesce((e ->> 'updated_at')::timestamptz, (e ->> 'created_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(payload -> 'inquiries', '[]'::jsonb)) as e
  on conflict (id) do nothing;
  get diagnostics n_inquiries = row_count;

  -- ── leads
  insert into public.leads (id, workspace, stage_id, name, company, email, phone, value, currency, score, source,
                            notes, next_action, position, inquiry_id, owner_id, created_by, created_at, updated_at)
  select (e ->> 'id')::uuid, 'live',
         coalesce((stage_map ->> (e ->> 'stage_id'))::uuid, first_stage),
         coalesce(nullif(btrim(e ->> 'name'), ''), 'Unnamed lead'), e ->> 'company', e ->> 'email', e ->> 'phone',
         coalesce((e ->> 'value')::numeric, 0), coalesce(nullif(e ->> 'currency', ''), 'LKR'),
         coalesce(nullif(e ->> 'score', ''), 'WARM'), coalesce(nullif(e ->> 'source', ''), 'manual'),
         e ->> 'notes', e ->> 'next_action', coalesce((e ->> 'position')::integer, 0),
         (select i.id from public.inquiries i where i.id = nullif(e ->> 'inquiry_id', '')::uuid and i.workspace = 'live'),
         coalesce(private.legacy_user(users, e ->> 'created_by', fallback), fallback),
         private.legacy_user(users, e ->> 'created_by', fallback),
         coalesce((e ->> 'created_at')::timestamptz, now()),
         coalesce((e ->> 'updated_at')::timestamptz, (e ->> 'created_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(payload -> 'leads', '[]'::jsonb)) as e
  on conflict (id) do nothing;
  get diagnostics n_leads = row_count;

  -- The link back is housekeeping, not an edit: updated_at stays as imported
  -- (the same move as 0012's backfill).
  alter table public.inquiries disable trigger inquiries_set_updated_at;
  update public.inquiries i
  set converted_lead_id = l.id
  from jsonb_array_elements(coalesce(payload -> 'inquiries', '[]'::jsonb)) as e
  join public.leads l on l.id = nullif(e ->> 'converted_lead_id', '')::uuid and l.workspace = 'live'
  where i.id = (e ->> 'id')::uuid and i.workspace = 'live' and i.converted_lead_id is null;
  alter table public.inquiries enable trigger inquiries_set_updated_at;

  -- ── the leads' trail, as it was
  insert into public.lead_activities (id, workspace, lead_id, kind, body, actor_id, created_at)
  select (e ->> 'id')::uuid, 'live', l.id, coalesce(nullif(e ->> 'kind', ''), 'note'), coalesce(e ->> 'body', ''),
         private.legacy_user(users, e ->> 'actor_id', fallback),
         coalesce((e ->> 'created_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(payload -> 'lead_activities', '[]'::jsonb)) as e
  join public.leads l on l.id = nullif(e ->> 'lead_id', '')::uuid and l.workspace = 'live'
  on conflict (id) do nothing;
  get diagnostics n_trail = row_count;

  -- ── ledger (all approved)
  insert into public.finance_entries (id, workspace, kind, entry_date, description, category, amount, currency, method,
                                      reference, lead_id, approval_status, created_by, created_at, updated_at)
  select (e ->> 'id')::uuid, 'live', (e ->> 'kind')::public.finance_kind,
         coalesce((e ->> 'entry_date')::date, ((e ->> 'created_at')::timestamptz at time zone 'Asia/Colombo')::date,
                  public.local_today()),
         coalesce(e ->> 'description', ''), coalesce(nullif(e ->> 'category', ''), 'General'),
         (e ->> 'amount')::numeric, coalesce(nullif(e ->> 'currency', ''), 'LKR'), e ->> 'method', e ->> 'reference',
         (select l.id from public.leads l where l.id = nullif(e ->> 'lead_id', '')::uuid and l.workspace = 'live'),
         'approved',
         private.legacy_user(users, e ->> 'created_by', fallback),
         coalesce((e ->> 'created_at')::timestamptz, now()),
         coalesce((e ->> 'updated_at')::timestamptz, (e ->> 'created_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(payload -> 'finance_entries', '[]'::jsonb)) as e
  on conflict (id) do nothing;
  get diagnostics n_ledger = row_count;

  -- ── calendar
  insert into public.calendar_events (id, workspace, title, description, starts_at, ends_at, all_day, kind, done,
                                      lead_id, inquiry_id, location, meeting_url, created_by, created_at, updated_at)
  select (e ->> 'id')::uuid, 'live', coalesce(nullif(btrim(e ->> 'title'), ''), 'Untitled'), e ->> 'description',
         (e ->> 'starts_at')::timestamptz, (e ->> 'ends_at')::timestamptz,
         coalesce((e ->> 'all_day')::boolean, false), coalesce(nullif(e ->> 'kind', ''), 'task'),
         coalesce((e ->> 'done')::boolean, false),
         (select l.id from public.leads l where l.id = nullif(e ->> 'lead_id', '')::uuid and l.workspace = 'live'),
         (select i.id from public.inquiries i where i.id = nullif(e ->> 'inquiry_id', '')::uuid and i.workspace = 'live'),
         e ->> 'location',
         case when e ->> 'meeting_url' ~* '^https?://' then e ->> 'meeting_url' end,
         private.legacy_user(users, e ->> 'created_by', fallback),
         coalesce((e ->> 'created_at')::timestamptz, now()),
         coalesce((e ->> 'updated_at')::timestamptz, (e ->> 'created_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(payload -> 'calendar_events', '[]'::jsonb)) as e
  on conflict (id) do nothing;
  get diagnostics n_events = row_count;

  -- ── mailbox flags
  insert into public.email_states (email_id, workspace, direction, read, starred, archived, trashed, updated_by,
                                   created_at, updated_at)
  select e ->> 'email_id', 'live', coalesce(nullif(e ->> 'direction', ''), 'inbound'),
         coalesce((e ->> 'read')::boolean, false), coalesce((e ->> 'starred')::boolean, false),
         coalesce((e ->> 'archived')::boolean, false), coalesce((e ->> 'trashed')::boolean, false),
         private.legacy_user(users, e ->> 'updated_by', fallback),
         coalesce((e ->> 'created_at')::timestamptz, now()),
         coalesce((e ->> 'updated_at')::timestamptz, (e ->> 'created_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(payload -> 'email_states', '[]'::jsonb)) as e
  where nullif(e ->> 'email_id', '') is not null
  on conflict (email_id) do nothing;
  get diagnostics n_mail = row_count;

  perform set_config('flowstate.importing', coalesce(prev_import, ''), true);

  return jsonb_build_object(
    'stages', n_stages,
    'inquiries', n_inquiries,
    'leads', n_leads,
    'lead_activities', n_trail,
    'finance_entries', n_ledger,
    'calendar_events', n_events,
    'email_states', n_mail
  );
end;
$$;

revoke execute on function public.import_legacy_data(jsonb) from public, anon, authenticated;
grant execute on function public.import_legacy_data(jsonb) to service_role;
