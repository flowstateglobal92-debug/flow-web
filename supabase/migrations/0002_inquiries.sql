-- ============================================================================
-- 0002 · Inquiries
-- Every submission of the public walkthrough form lands here. Anonymous
-- visitors may INSERT and nothing else; only admins can read, update or
-- delete. `converted_lead_id` is wired to the CRM in 0003.
-- Requires: 0001 (public.is_admin, public.set_updated_at)
-- ============================================================================

do $$ begin
  create type public.inquiry_status as enum ('new', 'read', 'converted', 'archived');
exception when duplicate_object then null;
end $$;

create table if not exists public.inquiries (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  business           text,
  contact            text not null,           -- WhatsApp number or email, as typed
  focus              text,                    -- "what slows you down most"
  message            text,
  source             text not null default 'website',
  page               text,                    -- which route the form was on
  status             public.inquiry_status not null default 'new',
  converted_lead_id  uuid,                    -- FK added in 0003
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.inquiries is
  'Public contact-form submissions. Admins triage them and push them into the CRM.';

create index if not exists inquiries_status_created_idx
  on public.inquiries (status, created_at desc);
create index if not exists inquiries_created_idx
  on public.inquiries (created_at desc);

drop trigger if exists inquiries_set_updated_at on public.inquiries;
create trigger inquiries_set_updated_at
  before update on public.inquiries
  for each row execute function public.set_updated_at();

-- ───────────────────────────── policies ────────────────────────────────────
alter table public.inquiries enable row level security;

-- The public form posts through the anon key. Insert only — no read-back.
drop policy if exists "inquiries: public can submit" on public.inquiries;
create policy "inquiries: public can submit"
  on public.inquiries for insert
  to anon, authenticated
  with check (true);

drop policy if exists "inquiries: admin manages" on public.inquiries;
create policy "inquiries: admin manages"
  on public.inquiries for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
