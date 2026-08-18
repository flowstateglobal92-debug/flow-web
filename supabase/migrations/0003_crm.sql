-- ============================================================================
-- 0003 · CRM (kanban pipeline)
-- Editable pipeline stages + leads + a per-lead activity trail.
-- The first stage ("New leads") is protected: it cannot be renamed, moved or
-- deleted, because inquiries and the public form drop into it by definition.
-- Requires: 0001 (is_admin, set_updated_at), 0002 (inquiries)
-- ============================================================================

-- ─────────────────────────── pipeline stages ───────────────────────────────
create table if not exists public.pipeline_stages (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique,                 -- 'new' on the protected stage
  position      integer not null default 0,
  tone          text not null default 'terra'
                  check (tone in ('terra', 'cream', 'success', 'warn', 'muted')),
  is_protected  boolean not null default false,
  is_won        boolean not null default false,
  is_lost       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.pipeline_stages is
  'Kanban columns. The row with slug = ''new'' is protected and cannot be renamed or removed.';

create index if not exists pipeline_stages_position_idx on public.pipeline_stages (position);

drop trigger if exists pipeline_stages_set_updated_at on public.pipeline_stages;
create trigger pipeline_stages_set_updated_at
  before update on public.pipeline_stages
  for each row execute function public.set_updated_at();

-- Default board.
insert into public.pipeline_stages (name, slug, position, tone, is_protected, is_won, is_lost)
values
  ('New leads',   'new',         0, 'terra',   true,  false, false),
  ('Contacted',   'contacted',   1, 'cream',   false, false, false),
  ('Proposal',    'proposal',    2, 'cream',   false, false, false),
  ('Negotiation', 'negotiation', 3, 'warn',    false, false, false),
  ('Won',         'won',         4, 'success', false, true,  false),
  ('Lost',        'lost',        5, 'muted',   false, false, true)
on conflict (slug) do nothing;

-- Guard the protected stage: no delete, no rename, no reposition.
create or replace function public.guard_protected_stage()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_protected then
      raise exception 'The "%" stage is protected and cannot be deleted.', old.name
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.is_protected then
    if new.name is distinct from old.name then
      raise exception 'The "%" stage is protected and cannot be renamed.', old.name
        using errcode = 'check_violation';
    end if;
    if new.position is distinct from old.position then
      raise exception 'The "%" stage is protected and must stay first.', old.name
        using errcode = 'check_violation';
    end if;
    if new.is_protected is distinct from old.is_protected then
      raise exception 'The protected flag on "%" cannot be cleared.', old.name
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists pipeline_stages_guard on public.pipeline_stages;
create trigger pipeline_stages_guard
  before update or delete on public.pipeline_stages
  for each row execute function public.guard_protected_stage();

-- ─────────────────────────────── leads ─────────────────────────────────────
create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  stage_id    uuid not null references public.pipeline_stages (id) on delete restrict,
  name        text not null,
  company     text,
  email       text,
  phone       text,
  value       numeric(14, 2) not null default 0 check (value >= 0),
  currency    text not null default 'LKR',
  score       text not null default 'WARM' check (score in ('HOT', 'WARM', 'COLD')),
  source      text not null default 'manual',
  notes       text,
  next_action text,
  position    integer not null default 0,     -- order inside its column
  inquiry_id  uuid references public.inquiries (id) on delete set null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.leads is 'CRM cards. `position` orders a lead inside its stage column.';

create index if not exists leads_stage_position_idx on public.leads (stage_id, position);
create index if not exists leads_created_idx on public.leads (created_at desc);
create unique index if not exists leads_inquiry_unique_idx
  on public.leads (inquiry_id) where inquiry_id is not null;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- Close the loop opened in 0002.
alter table public.inquiries
  drop constraint if exists inquiries_converted_lead_id_fkey;
alter table public.inquiries
  add constraint inquiries_converted_lead_id_fkey
  foreign key (converted_lead_id) references public.leads (id) on delete set null;

-- ────────────────────────── lead activities ────────────────────────────────
create table if not exists public.lead_activities (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads (id) on delete cascade,
  kind       text not null default 'note'
               check (kind in ('note', 'stage', 'created', 'call', 'message', 'meeting')),
  body       text not null,
  actor_id   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists lead_activities_lead_idx
  on public.lead_activities (lead_id, created_at desc);

-- Stage moves write their own trail entry so history survives UI shortcuts.
create or replace function public.log_lead_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  from_name text;
  to_name   text;
begin
  if tg_op = 'INSERT' then
    select name into to_name from public.pipeline_stages where id = new.stage_id;
    insert into public.lead_activities (lead_id, kind, body, actor_id)
    values (new.id, 'created', format('Lead created in %s', coalesce(to_name, 'pipeline')), auth.uid());
    return new;
  end if;

  if new.stage_id is distinct from old.stage_id then
    select name into from_name from public.pipeline_stages where id = old.stage_id;
    select name into to_name   from public.pipeline_stages where id = new.stage_id;
    insert into public.lead_activities (lead_id, kind, body, actor_id)
    values (new.id, 'stage', format('%s → %s', coalesce(from_name, '—'), coalesce(to_name, '—')), auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists leads_log_stage on public.leads;
create trigger leads_log_stage
  after insert or update of stage_id on public.leads
  for each row execute function public.log_lead_stage_change();

-- ──────────────── safe stage delete (moves leads first) ────────────────────
create or replace function public.delete_pipeline_stage(
  p_stage_id uuid,
  p_move_to  uuid default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  target uuid;
begin
  if (select is_protected from public.pipeline_stages where id = p_stage_id) then
    raise exception 'That stage is protected and cannot be deleted.'
      using errcode = 'check_violation';
  end if;

  target := coalesce(
    p_move_to,
    (select id from public.pipeline_stages
      where id <> p_stage_id order by position asc, created_at asc limit 1)
  );

  if target is null then
    raise exception 'A pipeline needs at least one stage.' using errcode = 'check_violation';
  end if;

  update public.leads set stage_id = target where stage_id = p_stage_id;
  delete from public.pipeline_stages where id = p_stage_id;
end;
$$;

grant execute on function public.delete_pipeline_stage(uuid, uuid) to authenticated;

-- ───────────────────────────── policies ────────────────────────────────────
alter table public.pipeline_stages enable row level security;
alter table public.leads           enable row level security;
alter table public.lead_activities enable row level security;

drop policy if exists "stages: admin manages" on public.pipeline_stages;
create policy "stages: admin manages"
  on public.pipeline_stages for all
  to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "leads: admin manages" on public.leads;
create policy "leads: admin manages"
  on public.leads for all
  to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "lead activities: admin manages" on public.lead_activities;
create policy "lead activities: admin manages"
  on public.lead_activities for all
  to authenticated
  using (public.is_admin()) with check (public.is_admin());
