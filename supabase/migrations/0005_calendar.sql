-- ============================================================================
-- 0005 · Calendar
-- The dashboard calendar. Events stand alone or hang off a lead / inquiry so
-- follow-ups scheduled from the CRM show up on the month grid.
-- Requires: 0001 (is_admin, set_updated_at), 0002 (inquiries), 0003 (leads)
-- ============================================================================

create table if not exists public.calendar_events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  all_day     boolean not null default false,
  kind        text not null default 'task'
                check (kind in ('task', 'meeting', 'follow_up', 'payment', 'other')),
  done        boolean not null default false,
  lead_id     uuid references public.leads (id) on delete cascade,
  inquiry_id  uuid references public.inquiries (id) on delete cascade,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint calendar_events_range check (ends_at is null or ends_at >= starts_at)
);

comment on table public.calendar_events is
  'Dashboard calendar. Events may be linked to a lead or an inquiry.';

create index if not exists calendar_events_starts_idx on public.calendar_events (starts_at);
create index if not exists calendar_events_lead_idx on public.calendar_events (lead_id);

drop trigger if exists calendar_events_set_updated_at on public.calendar_events;
create trigger calendar_events_set_updated_at
  before update on public.calendar_events
  for each row execute function public.set_updated_at();

-- ───────────────────────────── policies ────────────────────────────────────
alter table public.calendar_events enable row level security;

drop policy if exists "calendar: admin manages" on public.calendar_events;
create policy "calendar: admin manages"
  on public.calendar_events for all
  to authenticated
  using (public.is_admin()) with check (public.is_admin());
