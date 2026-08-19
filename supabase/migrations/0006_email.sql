-- ============================================================================
-- 0006 · Mailbox state
-- Resend is the store of record for message content: inbound mail lives behind
-- GET /emails/receiving, sent mail behind GET /emails, and both keep their own
-- attachments. Mirroring all of that into Postgres would only add drift, so the
-- only thing kept locally is what Resend has no concept of — which messages the
-- team has read, starred, archived or thrown away.
--
-- One row per Resend email id, created lazily the first time a flag is set.
-- Requires: 0001 (is_admin, set_updated_at)
-- ============================================================================

create table if not exists public.email_states (
  email_id    text primary key,           -- Resend email id (inbound or sent)
  direction   text not null default 'inbound'
                check (direction in ('inbound', 'outbound')),
  read        boolean not null default false,
  starred     boolean not null default false,
  archived    boolean not null default false,
  trashed     boolean not null default false,
  updated_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.email_states is
  'Read/star/archive/trash flags for Resend messages. Content itself stays in Resend.';

-- The unread badge counts inbound rows that are read = false; the folder views
-- filter on archived/trashed. Both are cheap over a partial index.
create index if not exists email_states_unread_idx
  on public.email_states (direction) where not read;
create index if not exists email_states_shelf_idx
  on public.email_states (archived, trashed);

drop trigger if exists email_states_set_updated_at on public.email_states;
create trigger email_states_set_updated_at
  before update on public.email_states
  for each row execute function public.set_updated_at();

-- ───────────────────────────── policies ────────────────────────────────────
alter table public.email_states enable row level security;

drop policy if exists "email: admin manages" on public.email_states;
create policy "email: admin manages"
  on public.email_states for all
  to authenticated
  using (public.is_admin()) with check (public.is_admin());
