-- ============================================================================
-- 0027 · Security hardening
-- Fixes from the security and money review of 0008–0025. Each part adds to,
-- or redefines by the same name, something an earlier migration set up, so
-- re-running the whole sequence still lands here last.
--
--   1. Auto-issuing schedules (0015). A member could re-time, back-date or
--      resume an admin's auto-issuing schedule, and the next run then
--      numbered and issued every catch-up period with no approval. While
--      auto-issue stays on, when and how often it bills (and resuming it) is
--      now an admin's call, like what it bills already was. A member's save
--      that also switches auto-issue off still goes through: the schedule
--      then makes drafts.
--   2. Catch-up is bounded (0015). A run made every period from next_run_on
--      to today, from whatever date the API wrote. The API can no longer set
--      a next run more than a year back. (The other half — one run makes at
--      most 24 invoices per schedule and 240 in all, and the next carries on
--      where it stopped — lives in 0015's private.run_recurring itself, so
--      the run has one definition.)
--   3. Workspace settings (0008). Admins could write every column of their
--      own workspace row, so the public demo login could set demo_reset_at in
--      the future and stop the sign-in reseed for good. The API now updates
--      only the settings the app edits: approval rules (0016) and the
--      opening balance (0022). A setting added later needs its own grant.
--   4. Leads' stages (0025). stage_id had no workspace guard, so a live lead
--      could sit on a demo stage (and the demo reset then refused to run) or
--      a demo lead on a live one. It is now checked like every other link —
--      delete_pipeline_stage's move included, since that is an update.
--   5. Client threads (0021). Comments followed their record's visibility,
--      and every module that picks a client (invoices, CRM, calendar,
--      to-dos) can read clients. A client's discussion now needs the Clients
--      module, the same audience its mentions and alerts already had.
--   6. The public form (0002/0008). anon kept table-wide INSERT, so a forged
--      submission could carry staff notes, a source or backdated timestamps.
--      It may now write only the form's own fields.
--   7. The receipts bucket (0017). 'image/*' let SVG in, and nothing bounded
--      how much the public demo login could store. Images are now listed by
--      type (no SVG), an entry holds at most 25 files, and the demo
--      workspace at most 50 in all (public.receipt_room).
-- Requires: 0026
-- ============================================================================

-- ─────────────────────── 1–2. recurring schedules ──────────────────────────
-- Its own trigger beside 0015's guard (which keeps what an auto-issuing
-- schedule bills and switching auto-issue on for admins). Named to fire after
-- invoice_schedules_guard and before invoice_schedules_zdates, so it judges
-- the dates as sent, before a resume or an off-cadence date is rewritten.
-- Only API callers are judged: the run itself (definer) moves next_run_on
-- and occurrences every period.
create or replace function private.guard_schedule_timing()
returns trigger
language plpgsql
security invoker
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- An auto-issuing schedule's invoices are numbered and issued with no
  -- review, so when, how often and how many times it bills — and resuming
  -- it — are an admin's call, like what it bills. Switching auto-issue off in
  -- the same save is fine: then it makes drafts. Pausing is always fine.
  if tg_op = 'UPDATE' and old.auto_issue and new.auto_issue and not public.is_admin() then
    if (new.frequency, new.interval_count, new.anchor_date, new.next_run_on, new.ends_on,
        new.max_occurrences, new.occurrences)
       is distinct from (old.frequency, old.interval_count, old.anchor_date, old.next_run_on, old.ends_on,
        old.max_occurrences, old.occurrences) then
      raise exception 'This schedule issues its invoices automatically, so only an admin can change when it bills.'
        using errcode = 'check_violation';
    end if;
    if new.active and not old.active then
      raise exception 'This schedule issues its invoices automatically, so only an admin can resume it.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- A run bills every period from next_run_on to today. Only a date that
  -- changes is judged, so a paused schedule saved as it is keeps its old one
  -- (resuming moves it to today anyway — schedule_run_dates, 0015).
  if (tg_op = 'INSERT' or new.next_run_on is distinct from old.next_run_on)
     and new.next_run_on < (public.local_today() - interval '1 year')::date then
    raise exception 'The next run can''t be more than a year ago.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_schedule_timing() from public, anon, authenticated;

drop trigger if exists invoice_schedules_guard_timing on public.invoice_schedules;
create trigger invoice_schedules_guard_timing
  before insert or update on public.invoice_schedules
  for each row execute function private.guard_schedule_timing();

-- ───────────────────────── 3. workspace settings ───────────────────────────
-- Table-level grants beat column grants, so revoke first. The row stays
-- readable (the app's .select('id') after an update still works); RLS still
-- limits the update to the caller's own workspace and to admins.
revoke update on public.workspaces from authenticated;
grant update (expense_approval_threshold, invoice_approval_threshold, leave_requires_approval,
              opening_balance, opening_balance_on)
  on public.workspaces to authenticated;

-- ─────────────────────────── 4. leads' stages ──────────────────────────────
-- Replaces 0025's trigger of the same name (one trigger, both links).
drop trigger if exists leads_guard_links on public.leads;
create trigger leads_guard_links
  before insert or update of inquiry_id, stage_id, workspace on public.leads
  for each row execute function private.guard_workspace_links('inquiry_id', 'inquiries', 'stage_id', 'pipeline_stages');

-- ─────────────────────────── 5. client threads ─────────────────────────────
-- As 0021, except a client's thread also needs the Clients module. Leads,
-- invoices and to-dos are already read only with their own module.
drop policy if exists "comments: read with the record" on public.comments;
create policy "comments: read with the record"
  on public.comments for select to authenticated
  using (
    case
      when comments.lead_id is not null then exists (select 1 from public.leads l where l.id = comments.lead_id)
      when comments.client_id is not null then (select public.can_access('clients'))
        and exists (select 1 from public.clients c where c.id = comments.client_id)
      when comments.invoice_id is not null then exists (select 1 from public.invoices i where i.id = comments.invoice_id)
      else exists (select 1 from public.todos t where t.id = comments.todo_id)
    end
  );

drop policy if exists "comments: add where visible" on public.comments;
create policy "comments: add where visible"
  on public.comments for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and case
      when comments.lead_id is not null then exists (select 1 from public.leads l where l.id = comments.lead_id)
      when comments.client_id is not null then (select public.can_access('clients'))
        and exists (select 1 from public.clients c where c.id = comments.client_id)
      when comments.invoice_id is not null then exists (select 1 from public.invoices i where i.id = comments.invoice_id)
      else exists (select 1 from public.todos t where t.id = comments.todo_id)
    end
  );

drop policy if exists "comments: author edits" on public.comments;
create policy "comments: author edits"
  on public.comments for update to authenticated
  using (
    author_id = (select auth.uid())
    and case
      when comments.lead_id is not null then exists (select 1 from public.leads l where l.id = comments.lead_id)
      when comments.client_id is not null then (select public.can_access('clients'))
        and exists (select 1 from public.clients c where c.id = comments.client_id)
      when comments.invoice_id is not null then exists (select 1 from public.invoices i where i.id = comments.invoice_id)
      else exists (select 1 from public.todos t where t.id = comments.todo_id)
    end
  )
  with check (author_id = (select auth.uid()));

drop policy if exists "comments: author deletes" on public.comments;
create policy "comments: author deletes"
  on public.comments for delete to authenticated
  using (
    author_id = (select auth.uid())
    and case
      when comments.lead_id is not null then exists (select 1 from public.leads l where l.id = comments.lead_id)
      when comments.client_id is not null then (select public.can_access('clients'))
        and exists (select 1 from public.clients c where c.id = comments.client_id)
      when comments.invoice_id is not null then exists (select 1 from public.invoices i where i.id = comments.invoice_id)
      else exists (select 1 from public.todos t where t.id = comments.todo_id)
    end
  );

-- ──────────────────────────── 6. public form ───────────────────────────────
-- Exactly what src/app/actions/contact.ts sends. Everything else — status,
-- workspace, notes, the CRM link, timestamps — keeps its default, and the
-- policy ("inquiries: public can submit", 0008) still pins the workspace,
-- status and link. anon reads, edits and deletes nothing (RLS already said
-- so; now the grants do too).
revoke all on public.inquiries from anon;
grant insert (name, business, contact, focus, message, source, page) on public.inquiries to anon;

-- ─────────────────────────── 7. receipts bucket ────────────────────────────
-- Room for one more receipt at this object name: fewer than 25 files in its
-- entry's folder and, in the demo workspace, fewer than 50 in all. The
-- upload policy below asks this, because a policy on storage.objects can't
-- query storage.objects itself (Postgres reports infinite recursion) —
-- hence definer, counting past RLS (the migration owner, postgres, bypasses
-- it on Supabase). It answers only for the caller's own workspace, with
-- Expenses access, and a real entry-shaped folder, so as an RPC it tells
-- nobody anything they couldn't list. plpgsql so it can be created where
-- there's no storage schema (it is only called once there is one).
create or replace function public.receipt_room(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  folders text[] := storage.foldername(p_name);
begin
  if folders[1] is distinct from public.current_workspace()
     or not public.can_access('finance')
     or coalesce(folders[2], '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return (select count(*) from storage.objects o
          where o.bucket_id = 'receipts' and o.name like folders[1] || '/' || folders[2] || '/%') < 25
     and (folders[1] <> 'demo'
          or (select count(*) from storage.objects o where o.bucket_id = 'receipts' and o.name like 'demo/%') < 50);
end;
$$;

revoke execute on function public.receipt_room(text) from public, anon, authenticated;
grant execute on function public.receipt_room(text) to authenticated, service_role;

-- Where Supabase Storage exists (0017 made the bucket). The upload policy is
-- 0017's plus receipt_room. The Storage API writes one object per request,
-- so each upload sees the ones before it. Old demo files are cleared by the
-- app's demo reset (Storage can't be emptied from SQL), which keeps the demo
-- under its cap.
do $$
begin
  if to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null
     or to_regprocedure('storage.foldername(text)') is null then
    raise notice 'No Supabase Storage here — the receipts bucket was not changed.';
    return;
  end if;

  update storage.buckets
  set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
                                 'application/pdf']
  where id = 'receipts';

  begin
    drop policy if exists "receipts: finance uploads" on storage.objects;
    create policy "receipts: finance uploads"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1] = (select public.current_workspace())
        and (select public.can_access('finance'))
        and exists (
          select 1 from public.finance_entries f
          where f.id = case when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                            then ((storage.foldername(name))[2])::uuid end
        )
        and public.receipt_room(name)
      );
  exception when insufficient_privilege then
    raise warning 'Receipts bucket narrowed, but its upload policy could not be replaced: % — update it in Storage → Policies.', sqlerrm;
  end;
end $$;
