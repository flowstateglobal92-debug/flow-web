-- ============================================================================
-- 0036 · Emailing documents
-- Invoices, quotes and credit notes go out from the company mailbox with the
-- PDF attached; statements (0037) and reminders (0038) too. Every send leaves
-- a line here, so a document shows when it went, to whom, and by whom.
--
--   document_emails — one row per message: the document (or, for a statement,
--     the client), recipients, subject, Resend's id, who sent it (null = the
--     scheduled reminders). Sent mail is never edited or removed through the
--     API. Readable with Invoices (and a client's statements with Clients).
--   invoice_settings.email_* — the default subject and message per kind, with
--     {client} {number} {amount} {due_date} {business} {sender} {pay_link}
--     filled in when sending. Empty = the built-in wording.
-- Requires: 0035. Idempotent.
-- ============================================================================

create table if not exists public.document_emails (
  id            uuid primary key default gen_random_uuid(),
  workspace     text not null default public.current_workspace() references public.workspaces (id),
  kind          text not null default 'document',
  invoice_id    uuid references public.invoices (id) on delete cascade,
  client_id     uuid references public.clients (id) on delete cascade,
  to_addresses  text[] not null,
  cc_addresses  text[] not null default '{}',
  subject       text not null,
  resend_id     text,
  step          integer,
  sent_by       uuid references auth.users (id) on delete set null,
  sent_at       timestamptz not null default now()
);

comment on table public.document_emails is
  'Documents, statements and reminders sent from the company mailbox (0036). Never edited through the API.';

alter table public.document_emails drop constraint if exists document_emails_values_check;
alter table public.document_emails
  add constraint document_emails_values_check check (
    kind in ('document', 'reminder', 'statement')
    and (invoice_id is not null or client_id is not null)
    and cardinality(to_addresses) between 1 and 20
    and cardinality(cc_addresses) <= 20
    and char_length(subject) between 1 and 300
    and (step is null or step between 1 and 10)
  );

create index if not exists document_emails_invoice_idx on public.document_emails (invoice_id, sent_at desc);
create index if not exists document_emails_client_idx on public.document_emails (client_id, sent_at desc);

-- Whoever sends it, never what the caller claims; the scheduled reminders
-- (service role, no session) leave it empty.
create or replace function private.stamp_document_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.sent_by := auth.uid();
  new.sent_at := now();
  if new.invoice_id is not null then
    select i.workspace, coalesce(new.client_id, i.client_id) into new.workspace, new.client_id
    from public.invoices i where i.id = new.invoice_id;
  elsif new.client_id is not null then
    select c.workspace into new.workspace from public.clients c where c.id = new.client_id;
  end if;
  return new;
end;
$$;

revoke execute on function private.stamp_document_email() from public, anon, authenticated;

drop trigger if exists document_emails_stamp on public.document_emails;
create trigger document_emails_stamp
  before insert on public.document_emails
  for each row execute function private.stamp_document_email();

-- The audit line: "emailed INV-0007 to accounts@kite.lk".
create or replace function private.log_document_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  doc public.invoices;
begin
  if new.invoice_id is not null then
    select * into doc from public.invoices where id = new.invoice_id;
    perform private.log_event(
      new.workspace,
      case new.kind when 'reminder' then 'reminder_sent' else 'document_emailed' end,
      'invoice', new.invoice_id, doc.number,
      format('%s %s to %s',
        case new.kind when 'reminder' then 'sent a payment reminder for' else 'emailed' end,
        coalesce(doc.number, 'a draft'), array_to_string(new.to_addresses, ', '))
    );
  end if;
  return null;
end;
$$;

revoke execute on function private.log_document_email() from public, anon, authenticated;

drop trigger if exists document_emails_activity on public.document_emails;
create trigger document_emails_activity
  after insert on public.document_emails
  for each row execute function private.log_document_email();

alter table public.document_emails enable row level security;

drop policy if exists "workspace fence" on public.document_emails;
create policy "workspace fence" on public.document_emails as restrictive for all to authenticated
  using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
  with check (workspace = (select public.current_workspace()) and (select public.is_active_member()));

-- A document's mail with Invoices; a client's statements with Clients too.
drop policy if exists "document emails: read" on public.document_emails;
create policy "document emails: read"
  on public.document_emails for select to authenticated
  using (
    (select public.can_access('invoices'))
    or (invoice_id is null and (select public.can_access('clients')))
  );

-- Recorded by whoever sent it, after the send (the stamp sets sent_by).
drop policy if exists "document emails: record" on public.document_emails;
create policy "document emails: record"
  on public.document_emails for insert to authenticated
  with check (
    (invoice_id is not null and (select public.can_access('invoices'))
       and exists (select 1 from public.invoices i where i.id = invoice_id))
    or (invoice_id is null and client_id is not null
        and ((select public.can_access('invoices')) or (select public.can_access('clients')))
        and exists (select 1 from public.clients c where c.id = client_id))
  );

revoke all on public.document_emails from anon;
revoke update, delete, truncate on public.document_emails from authenticated;

-- ───────────────────────────── default wording ─────────────────────────────
alter table public.invoice_settings add column if not exists email_invoice_subject text;
alter table public.invoice_settings add column if not exists email_invoice_body text;
alter table public.invoice_settings add column if not exists email_quote_subject text;
alter table public.invoice_settings add column if not exists email_quote_body text;
alter table public.invoice_settings add column if not exists email_credit_subject text;
alter table public.invoice_settings add column if not exists email_credit_body text;

alter table public.invoice_settings drop constraint if exists invoice_settings_email_check;
alter table public.invoice_settings
  add constraint invoice_settings_email_check check (
    coalesce(char_length(email_invoice_subject), 0) <= 200 and coalesce(char_length(email_invoice_body), 0) <= 4000
    and coalesce(char_length(email_quote_subject), 0) <= 200 and coalesce(char_length(email_quote_body), 0) <= 4000
    and coalesce(char_length(email_credit_subject), 0) <= 200 and coalesce(char_length(email_credit_body), 0) <= 4000
  );

-- ───────────────────────────── desktop sync ────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'powersync')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'powersync' and schemaname = 'public' and tablename = 'document_emails') then
    alter publication powersync add table public.document_emails;
  end if;
end;
$$;
