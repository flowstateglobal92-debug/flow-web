-- ============================================================================
-- 0016 · Approvals
-- Big money from members waits for an admin's yes:
--   · an expense at or over the workspace's expense threshold lands 'pending'
--     and doesn't count anywhere (totals, budgets, reports) until approved;
--   · issuing an invoice at or over the invoice threshold parks it as
--     'pending_approval' with no number — approving issues and numbers it,
--     rejecting hands it back as a draft;
--   · time off (0019) asks too when the workspace says leave needs approval.
-- Admins sign off their own. Each ask is one approval_requests row; approvers
-- hear about it through the bell, the requester hears the answer.
--
-- The record carries its own state (finance_entries.approval_status, the
-- invoice's status) so every screen and total can filter on it; the request
-- is the queue and the history. They stay in step through triggers: a record
-- that stops waiting for any reason other than a decision (edited under the
-- line, deleted) withdraws its request.
--
-- Decisions only go through decide_approval(). The API can't write requests
-- and can't touch approval_status — an invoker guard turns members' big
-- expenses pending and refuses hand-set approvals (0013 already locks an
-- invoice's pending_approval status the same way).
-- Requires: 0015
-- ============================================================================

-- ───────────────────────────── settings ────────────────────────────────────
alter table public.workspaces
  add column if not exists expense_approval_threshold numeric(14, 2) not null default 50000;
alter table public.workspaces
  add column if not exists invoice_approval_threshold numeric(14, 2) not null default 500000;
alter table public.workspaces
  add column if not exists leave_requires_approval boolean not null default true;

alter table public.workspaces drop constraint if exists workspaces_approval_thresholds_check;
alter table public.workspaces
  add constraint workspaces_approval_thresholds_check check (
    expense_approval_threshold >= 0 and invoice_approval_threshold >= 0
  );

comment on column public.workspaces.expense_approval_threshold is
  'Members'' expenses at or over this (LKR) wait for an admin.';
comment on column public.workspaces.invoice_approval_threshold is
  'Members'' invoices at or over this total wait for an admin before they''re numbered. Compared with the total as written (no exchange rates).';

-- ──────────────────────── ledger approval state ────────────────────────────
-- Everything already in the ledger (and every invoice payment) is approved.
alter table public.finance_entries
  add column if not exists approval_status text not null default 'approved';
alter table public.finance_entries add column if not exists approval_note text;

alter table public.finance_entries drop constraint if exists finance_entries_approval_status_check;
alter table public.finance_entries
  add constraint finance_entries_approval_status_check check (approval_status in ('approved', 'pending', 'rejected'));

comment on column public.finance_entries.approval_status is
  'approved counts in every total; pending/rejected entries are shown but never summed.';

create index if not exists finance_entries_unapproved_idx
  on public.finance_entries (workspace, approval_status) where approval_status <> 'approved';

-- Same columns as 0004, approved rows only.
create or replace view public.finance_monthly
with (security_invoker = on) as
select
  date_trunc('month', entry_date)::date                                as month,
  sum(amount) filter (where kind = 'income')::numeric(14, 2)           as income,
  sum(amount) filter (where kind = 'expense')::numeric(14, 2)          as expense,
  coalesce(sum(signed_amount), 0)::numeric(14, 2)                      as profit,
  count(*)                                                             as entries
from public.finance_entries
where approval_status = 'approved'
group by 1
order by 1 desc;

create or replace view public.finance_totals
with (security_invoker = on) as
select
  coalesce(sum(amount) filter (where kind = 'income'), 0)::numeric(14, 2)  as income,
  coalesce(sum(amount) filter (where kind = 'expense'), 0)::numeric(14, 2) as expense,
  coalesce(sum(signed_amount), 0)::numeric(14, 2)                          as profit,
  count(*)                                                                 as entries
from public.finance_entries
where approval_status = 'approved';

revoke all on public.finance_monthly, public.finance_totals from anon;
grant select on public.finance_monthly, public.finance_totals to authenticated;

-- ─────────────────────────── the requests ──────────────────────────────────
create table if not exists public.approval_requests (
  id           uuid primary key default gen_random_uuid(),
  workspace    text not null default public.current_workspace() references public.workspaces (id),
  entity_type  text not null,
  entity_id    uuid not null,                -- finance_entries / invoices / time_off row
  requested_by uuid references public.profiles (id) on delete set null,
  amount       numeric(14, 2),
  currency     text,
  summary      text not null,                -- "Office chairs · Furniture" — the card's title
  status       text not null default 'pending',
  decided_by   uuid references public.profiles (id) on delete set null,
  decided_at   timestamptz,
  note         text,                         -- the approver's reason
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.approval_requests is
  'Sign-off queue and history. Written by triggers and decide_approval() only.';

alter table public.approval_requests drop constraint if exists approval_requests_entity_type_check;
alter table public.approval_requests
  add constraint approval_requests_entity_type_check check (entity_type in ('expense', 'invoice', 'time_off'));

alter table public.approval_requests drop constraint if exists approval_requests_status_check;
alter table public.approval_requests
  add constraint approval_requests_status_check check (status in ('pending', 'approved', 'rejected', 'cancelled'));

-- One open ask per record; the history can hold many.
create unique index if not exists approval_requests_pending_key
  on public.approval_requests (entity_type, entity_id) where status = 'pending';
create index if not exists approval_requests_workspace_idx
  on public.approval_requests (workspace, status, created_at desc);
create index if not exists approval_requests_requested_by_idx on public.approval_requests (requested_by);
create index if not exists approval_requests_entity_idx on public.approval_requests (entity_type, entity_id);

drop trigger if exists approval_requests_set_updated_at on public.approval_requests;
create trigger approval_requests_set_updated_at
  before update on public.approval_requests
  for each row execute function public.set_updated_at();

alter table public.approval_requests enable row level security;

drop policy if exists "workspace fence" on public.approval_requests;
create policy "workspace fence" on public.approval_requests as restrictive for all to authenticated
  using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
  with check (workspace = (select public.current_workspace()) and (select public.is_active_member()));

-- Your own asks, or all of them if you're the one who answers.
drop policy if exists "approval requests: own or approver" on public.approval_requests;
create policy "approval requests: own or approver"
  on public.approval_requests for select to authenticated
  using (requested_by = (select auth.uid()) or (select public.is_admin()));

revoke all on public.approval_requests from anon;
revoke insert, update, delete, truncate on public.approval_requests from authenticated;

-- No activity trigger here: a decision is logged on the record it changes
-- (the entry's approval status, the invoice's number), with the approver as actor.

-- ─────────────────────────────── helpers ───────────────────────────────────
create or replace function private.approval_label(p_entity_type text)
returns text
language sql
immutable
as $$
  select case p_entity_type when 'expense' then 'Expense' when 'invoice' then 'Invoice' else 'Time off' end;
$$;

-- Open (or refresh) the one pending ask for a record. A record still waiting
-- keeps its request and requester; only what it's for and how much follow.
-- 0019 uses this for time off.
create or replace function private.request_approval(
  p_workspace    text,
  p_entity_type  text,
  p_entity_id    uuid,
  p_requested_by uuid,
  p_summary      text,
  p_amount       numeric default null,
  p_currency     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid;
  v_summary text := coalesce(nullif(left(btrim(p_summary), 200), ''), private.approval_label(p_entity_type));
begin
  update public.approval_requests
  set summary = v_summary, amount = p_amount, currency = p_currency
  where entity_type = p_entity_type and entity_id = p_entity_id and status = 'pending'
  returning id into v_id;
  if found then
    return v_id;
  end if;

  insert into public.approval_requests (workspace, entity_type, entity_id, requested_by, amount, currency, summary)
  values (
    p_workspace, p_entity_type, p_entity_id,
    (select p.id from public.profiles p where p.id = p_requested_by and p.workspace = p_workspace),
    p_amount, p_currency, v_summary
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- The record stopped waiting without a decision (edited under the line,
-- deleted, cancelled): its ask is withdrawn.
create or replace function private.cancel_approval(p_entity_type text, p_entity_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.approval_requests
  set status = 'cancelled', decided_at = now()
  where entity_type = p_entity_type and entity_id = p_entity_id and status = 'pending';
$$;

revoke execute on function private.approval_label(text),
  private.request_approval(text, text, uuid, uuid, text, numeric, text),
  private.cancel_approval(text, uuid)
  from public, anon, authenticated;

-- ───────────────────────── approvers hear about it ─────────────────────────
-- A new ask goes to every approver but the requester, whoever opened it
-- (a trigger here, 0019's time off, the demo seed). Once it's answered or
-- withdrawn the other approvers' unread asks are stale, so they're cleared.
-- The answer itself is sent by decide_approval, which knows the outcome.
create or replace function private.notify_approval_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      return null;
    end if;
    select coalesce(nullif(btrim(p.full_name), ''), p.email) into who
    from public.profiles p where p.id = new.requested_by;

    perform private.notify(
      array(select private.admins_of(new.workspace)),
      new.workspace,
      'approval_requested',
      format('%s needs approval · %s', private.approval_label(new.entity_type), new.summary),
      nullif(concat_ws(' · ', who,
        case when new.amount is not null then private.money(new.amount, new.currency) end), ''),
      '/admin/approvals?open=' || new.id,
      'approval', new.id,
      now(),
      new.requested_by
    );
  elsif old.status = 'pending' and new.status <> 'pending' then
    delete from public.notifications
    where entity_type = 'approval' and entity_id = new.id
      and type = 'approval_requested' and read_at is null;
  end if;
  return null;
end;
$$;

revoke execute on function private.notify_approval_request() from public, anon, authenticated;

drop trigger if exists approval_requests_notify on public.approval_requests;
create trigger approval_requests_notify
  after insert or update of status on public.approval_requests
  for each row execute function private.notify_approval_request();

-- ─────────────────────────────── expenses ──────────────────────────────────
-- Invoker on purpose (see private.guard_profiles): only API callers are held
-- to it. Trusted paths (decide_approval, invoice payments, the seed, the
-- import) write approval_status as they please.
--   · the API never sets approval_status / approval_note itself;
--   · a member's expense at or over the threshold is pending, on insert and
--     on any edit to what was approved (rejected + edited = asked again);
--   · edited under the line (or into income), there's nothing to sign off;
--   · an admin's entries are approved, and an admin's edit leaves someone
--     else's pending or rejected entry as it stands — that's for Approvals.
create or replace function private.guard_expense_approval()
returns trigger
language plpgsql
security invoker
as $$
declare
  line      numeric(14, 2);
  over_line boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and (new.approval_status is distinct from old.approval_status
          or new.approval_note is distinct from old.approval_note) then
    raise exception 'Approval is decided in Approvals — an admin approves or rejects it there.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    new.approval_status := 'approved';
    new.approval_note := null;
  end if;

  if public.is_admin() then
    return new;
  end if;

  -- Read as the caller: their own workspace row (the fence rejects any other).
  select w.expense_approval_threshold into line from public.workspaces w where w.id = new.workspace;
  over_line := new.kind = 'expense' and new.amount >= coalesce(line, 50000);

  if tg_op = 'INSERT' then
    if over_line then
      new.approval_status := 'pending';
    end if;
    return new;
  end if;

  if not over_line then
    new.approval_status := 'approved';
    new.approval_note := null;
  elsif old.approval_status = 'rejected'
     or (old.approval_status = 'approved'
         and (new.kind, new.amount, new.currency, new.category, new.entry_date, new.description)
             is distinct from (old.kind, old.amount, old.currency, old.category, old.entry_date, old.description)) then
    -- Method and reference are bookkeeping; anything about the spend itself is asked again.
    new.approval_status := 'pending';
    new.approval_note := null;
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_expense_approval() from public, anon, authenticated;

drop trigger if exists finance_entries_guard_approval on public.finance_entries;
create trigger finance_entries_guard_approval
  before insert or update on public.finance_entries
  for each row execute function private.guard_expense_approval();

-- Keeps the request in step with the entry. The requester is whoever made it
-- wait: the creator of a new row, the editor of an existing one.
create or replace function private.sync_expense_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.approval_status = 'pending' then
      perform private.cancel_approval('expense', old.id);
    end if;
    return null;
  end if;

  if new.approval_status = 'pending' then
    if tg_op = 'INSERT'
       or old.approval_status <> 'pending'
       or (new.amount, new.currency, new.description, new.category)
          is distinct from (old.amount, old.currency, old.description, old.category) then
      perform private.request_approval(
        new.workspace, 'expense', new.id,
        case when tg_op = 'INSERT' then coalesce(new.created_by, auth.uid()) else coalesce(auth.uid(), new.created_by) end,
        concat_ws(' · ', nullif(btrim(new.description), ''), nullif(btrim(new.category), '')),
        new.amount, new.currency
      );
    end if;
  elsif tg_op = 'UPDATE' and old.approval_status = 'pending' then
    perform private.cancel_approval('expense', new.id);
  end if;
  return null;
end;
$$;

revoke execute on function private.sync_expense_approval() from public, anon, authenticated;

drop trigger if exists finance_entries_approval on public.finance_entries;
create trigger finance_entries_approval
  after insert or update or delete on public.finance_entries
  for each row execute function private.sync_expense_approval();

-- ─────────────────────────────── invoices ──────────────────────────────────
-- Entering pending_approval opens the ask (issue_document, or a trusted
-- insert such as the demo seed); a new total or bill-to while waiting
-- refreshes it; leaving it any other way than a decision — or being
-- deleted — withdraws it.
create or replace function private.sync_invoice_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'pending_approval' then
      perform private.cancel_approval('invoice', old.id);
    end if;
    return null;
  end if;

  if new.status = 'pending_approval' then
    if tg_op = 'INSERT'
       or old.status <> 'pending_approval'
       or (new.total, new.currency, new.bill_to_company, new.bill_to_name, new.subject)
          is distinct from (old.total, old.currency, old.bill_to_company, old.bill_to_name, old.subject) then
      perform private.request_approval(
        new.workspace, 'invoice', new.id,
        case when tg_op = 'INSERT' then coalesce(new.created_by, auth.uid()) else coalesce(auth.uid(), new.created_by) end,
        concat_ws(' · ',
          coalesce(nullif(btrim(new.bill_to_company), ''), nullif(btrim(new.bill_to_name), ''), 'Invoice'),
          nullif(btrim(new.subject), '')),
        new.total, new.currency
      );
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'pending_approval' then
    perform private.cancel_approval('invoice', new.id);
  end if;
  return null;
end;
$$;

revoke execute on function private.sync_invoice_approval() from public, anon, authenticated;

drop trigger if exists invoices_approval on public.invoices;
create trigger invoices_approval
  after insert or update or delete on public.invoices
  for each row execute function private.sync_invoice_approval();

-- Issuing small and editing big afterwards would skip the queue: a member
-- can't raise an issued invoice to the threshold or over it. AFTER, so it
-- judges the total the totals trigger just worked out. Invoker on purpose
-- (see private.guard_profiles): only API callers are held to it.
create or replace function private.guard_issued_invoice_total()
returns trigger
language plpgsql
security invoker
as $$
declare
  line numeric(14, 2);
begin
  if current_user not in ('authenticated', 'anon')
     or new.kind <> 'invoice'
     or new.status not in ('issued', 'partially_paid', 'paid')
     or new.total <= old.total
     or public.is_admin() then
    return null;
  end if;
  select w.invoice_approval_threshold into line from public.workspaces w where w.id = new.workspace;
  line := coalesce(line, 500000);
  if new.total >= line then
    -- Spelled out here: private.money is out of an API caller's reach.
    raise exception 'Issued invoices of % % or more need an admin — ask one to make this change.',
      case new.currency when 'LKR' then 'Rs' else new.currency end, to_char(line, 'FM999,999,999,990')
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

revoke execute on function private.guard_issued_invoice_total() from public, anon, authenticated;

drop trigger if exists invoices_guard_issued_total on public.invoices;
create trigger invoices_guard_issued_total
  after update on public.invoices
  for each row execute function private.guard_issued_invoice_total();

-- ───────────────────────── issue_document, again ────────────────────────────
-- 0013's issue_document plus the approval branch: a member's invoice at or
-- over the threshold waits instead of being numbered. It's checked the way
-- issuing would check it first, so what an admin approves can always issue.
-- Quotes and admins' invoices issue as before.
create or replace function public.issue_document(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  doc  public.invoices;
  line numeric(14, 2);
begin
  if not public.can_access('invoices') then
    raise exception 'You don''t have access to Invoices.' using errcode = '42501';
  end if;
  select * into doc from public.invoices
  where id = p_id and workspace = public.current_workspace()
  for update;
  if not found then
    raise exception 'That document isn''t available.' using errcode = 'P0002';
  end if;
  if doc.status = 'pending_approval' then
    raise exception 'This invoice is waiting for approval — an admin approves or rejects it.'
      using errcode = 'check_violation';
  end if;

  if doc.kind = 'invoice' and doc.status = 'draft' and not public.is_admin() then
    select w.invoice_approval_threshold into line from public.workspaces w where w.id = doc.workspace;
    if doc.total >= coalesce(line, 500000) then
      if btrim(doc.bill_to_name) = '' then
        raise exception 'Add who this is billed to before issuing it.' using errcode = 'check_violation';
      end if;
      if not exists (select 1 from public.invoice_items where invoice_id = p_id) then
        raise exception 'Add at least one line item before issuing it.' using errcode = 'check_violation';
      end if;
      update public.invoices set status = 'pending_approval' where id = p_id;
      return jsonb_build_object('status', 'pending_approval', 'number', null);
    end if;
  end if;

  return private.issue_invoice(p_id);
end;
$$;

revoke execute on function public.issue_document(uuid) from public, anon, authenticated;
grant execute on function public.issue_document(uuid) to authenticated, service_role;

-- ───────────────────────────── decide_approval ──────────────────────────────
-- An approver answers one pending ask in their workspace (never their own).
--   approve: expense → approved · invoice → numbered and issued · time off →
--            private.apply_time_off_decision (0019), if that exists
--   reject:  expense → rejected · invoice → back to draft · time off → same hook
-- The note is kept on the request (and on the expense). The requester hears
-- the answer. Definer: the record changes happen as a trusted path, past the
-- API guards; the checks above stand in for them.
create or replace function public.decide_approval(p_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.approval_requests;
  v_status text;
  v_note   text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
  v_doc    text;
  issued   jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can approve or reject requests.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'Pick approve or reject.' using errcode = '22023';
  end if;

  select * into r from public.approval_requests
  where id = p_id and workspace = public.current_workspace()
  for update;
  if not found then
    raise exception 'That request isn''t available.' using errcode = 'P0002';
  end if;
  if r.requested_by = auth.uid() then
    raise exception 'You can''t decide your own request — another admin has to.' using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request has already been %.',
      case r.status when 'cancelled' then 'withdrawn' else r.status end
      using errcode = 'check_violation';
  end if;

  v_status := case p_decision when 'approve' then 'approved' else 'rejected' end;

  -- Close the ask first: the record's own trigger withdraws whatever is still
  -- pending when it stops waiting, and this one no longer is.
  update public.approval_requests
  set status = v_status, decided_by = auth.uid(), decided_at = now(), note = v_note
  where id = r.id;

  if r.entity_type = 'expense' then
    update public.finance_entries
    set approval_status = v_status, approval_note = v_note
    where id = r.entity_id and workspace = r.workspace and approval_status = 'pending';
    if not found then
      raise exception 'This expense is no longer waiting for approval.' using errcode = 'check_violation';
    end if;

  elsif r.entity_type = 'invoice' then
    select i.status into v_doc from public.invoices i
    where i.id = r.entity_id and i.workspace = r.workspace
    for update;
    if v_doc is distinct from 'pending_approval' then
      raise exception 'This invoice is no longer waiting for approval.' using errcode = 'check_violation';
    end if;
    if p_decision = 'approve' then
      issued := private.issue_invoice(r.entity_id);
    else
      update public.invoices set status = 'draft' where id = r.entity_id;
    end if;

  else
    -- Looked up at run time: time off arrives in 0019.
    if to_regprocedure('private.apply_time_off_decision(uuid, text, text)') is null then
      raise exception 'Time off can''t be decided yet.' using errcode = 'feature_not_supported';
    end if;
    execute 'select private.apply_time_off_decision($1, $2, $3)' using r.entity_id, p_decision, v_note;
  end if;

  perform private.notify(
    array[r.requested_by],
    r.workspace,
    'approval_decided',
    format('%s %s · %s', private.approval_label(r.entity_type), v_status, r.summary),
    nullif(concat_ws(' · ',
      case when issued is not null then 'Issued as ' || (issued ->> 'number') end,
      case when r.amount is not null then private.money(r.amount, r.currency) end,
      v_note
    ), ''),
    '/admin/approvals?open=' || r.id,
    'approval', r.id
  );

  return jsonb_build_object(
    'id', r.id, 'status', v_status, 'entity_type', r.entity_type, 'entity_id', r.entity_id,
    'number', issued ->> 'number'
  );
end;
$$;

revoke execute on function public.decide_approval(uuid, text, text) from public, anon, authenticated;
grant execute on function public.decide_approval(uuid, text, text) to authenticated, service_role;
