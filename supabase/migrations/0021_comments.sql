-- ============================================================================
-- 0021 · Comments & @mentions
-- One discussion table for the four records people talk about: a lead, a
-- client, an invoice (or quote) and a to-do. Each comment hangs off exactly
-- one of them and goes with it when it's deleted.
--
-- Who sees what is never decided here: a comment is visible to whoever can
-- see its record, under their own RLS — so a CRM-only member reads lead
-- threads but no invoice threads, and a private to-do's thread stays with its
-- participants. Anyone who can see the record may add to it; only the author
-- edits or deletes their own words.
--
-- Mentions are cleaned by the database, whatever the app sends: deduplicated,
-- in order, and only people who can open the record's module (crm, clients,
-- invoices, todos) in its workspace — and, on a private to-do, only its
-- participants. The bell then tells:
--   · `mention`  — everyone newly mentioned;
--   · `comment`  — everyone else involved who can open the record: the lead's
--     owner, the client's account manager, the invoice's owner, the to-do's
--     creator and assignees, and whoever commented on it before.
-- The author never hears about their own comment. Editing a comment only
-- alerts the people it newly mentions; deleting it (or un-mentioning someone)
-- takes back the alerts nobody has read yet.
--
-- The activity log gets one line per comment added or deleted, against the
-- record — never the words themselves, and nothing for private to-dos.
-- Requires: 0020
-- ============================================================================

-- ─────────────────────────────── table ─────────────────────────────────────
create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  workspace   text not null default public.current_workspace() references public.workspaces (id),
  lead_id     uuid references public.leads (id) on delete cascade,
  client_id   uuid references public.clients (id) on delete cascade,
  invoice_id  uuid references public.invoices (id) on delete cascade,
  todo_id     uuid references public.todos (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  body        text not null,
  mentions    uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);

comment on table public.comments is
  'Discussion on a lead, client, invoice or to-do. Visible with its record; written by anyone who can see it, edited by its author.';
comment on column public.comments.mentions is
  'People @mentioned, filtered by the database to those who can open the record.';

alter table public.comments drop constraint if exists comments_target_check;
alter table public.comments
  add constraint comments_target_check check (num_nonnulls(lead_id, client_id, invoice_id, todo_id) = 1);

alter table public.comments drop constraint if exists comments_body_check;
alter table public.comments
  add constraint comments_body_check check (btrim(body) <> '' and length(body) <= 5000);

create index if not exists comments_workspace_idx on public.comments (workspace);
create index if not exists comments_lead_idx on public.comments (lead_id, created_at) where lead_id is not null;
create index if not exists comments_client_idx on public.comments (client_id, created_at) where client_id is not null;
create index if not exists comments_invoice_idx on public.comments (invoice_id, created_at) where invoice_id is not null;
create index if not exists comments_todo_idx on public.comments (todo_id, created_at) where todo_id is not null;
create index if not exists comments_author_idx on public.comments (author_id);

-- ─────────────────────────────── helpers ───────────────────────────────────
-- What a comment is about: the record's kind, the module that opens it, a
-- short label and link for alerts, and who's involved with it. Read past RLS
-- (definer) — callers decide who may hear about it.
create or replace function private.comment_parent(
  p_comment    public.comments,
  out kind     text,
  out module   text,
  out record_id uuid,
  out label    text,
  out link     text,
  out is_private boolean,
  out involved uuid[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  is_private := false;
  if p_comment.lead_id is not null then
    kind := 'lead';
    module := 'crm';
    record_id := p_comment.lead_id;
    link := '/admin/crm?lead=' || p_comment.lead_id;
    select coalesce(nullif(btrim(l.company), ''), l.name), array[l.owner_id]
    into label, involved
    from public.leads l where l.id = p_comment.lead_id;
  elsif p_comment.client_id is not null then
    kind := 'client';
    module := 'clients';
    record_id := p_comment.client_id;
    link := '/admin/clients/' || p_comment.client_id;
    select c.name, array[c.account_manager_id]
    into label, involved
    from public.clients c where c.id = p_comment.client_id;
  elsif p_comment.invoice_id is not null then
    module := 'invoices';
    record_id := p_comment.invoice_id;
    link := '/admin/invoices/' || p_comment.invoice_id || '?tab=comments';  -- the thread's tab, not the paper
    select i.kind, coalesce(i.number, 'Draft ' || i.kind), array[i.owner_id]
    into kind, label, involved
    from public.invoices i where i.id = p_comment.invoice_id;
    kind := coalesce(kind, 'invoice');
  else
    kind := 'todo';
    module := 'todos';
    record_id := p_comment.todo_id;
    link := '/admin/todos?open=' || p_comment.todo_id;
    select t.title, t.is_private,
           array[t.created_by] || array(select a.user_id from public.todo_assignees a where a.todo_id = t.id)
    into label, is_private, involved
    from public.todos t where t.id = p_comment.todo_id;
  end if;
  involved := array_remove(coalesce(involved, '{}'), null);
end;
$$;

-- The people in p_people who can open the comment's record, deduplicated, in
-- the order given: module access in the comment's workspace, and on a private
-- to-do, its creator or an assignee.
create or replace function private.comment_audience(p_comment public.comments, p_people uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ctx record := private.comment_parent(p_comment);
begin
  return coalesce(array(
    select d.u
    from (
      select distinct on (x.u) x.u, x.ord
      from unnest(coalesce(p_people, '{}')) with ordinality as x(u, ord)
      where x.u is not null
      order by x.u, x.ord
    ) d
    where d.u in (select private.users_with_access(ctx.module, p_comment.workspace))
      and (not ctx.is_private or d.u = any (ctx.involved))
    order by d.ord
  ), '{}');
end;
$$;

revoke execute on function private.comment_parent(public.comments), private.comment_audience(public.comments, uuid[])
  from public, anon, authenticated;

-- ─────────────────────────── before triggers ───────────────────────────────
-- Invoker on purpose (see private.guard_profiles): it must see the API role.
-- From the API the author is the caller, for good, and a comment is born now
-- and unedited; an edit to its words (or mentions) stamps edited_at. Trusted
-- paths (the demo seed) may set the author and backdate both.
-- The author is pinned for API callers only (not with 0018's stamp_by, which
-- pins it on every update): deleting an account sets author_id to null through
-- the foreign key — a trusted update — and the comment stays, unsigned.
-- Runs first among the BEFORE triggers (by name).
create or replace function private.guard_comments()
returns trigger
language plpgsql
security invoker
as $$
declare
  api boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'INSERT' then
    if api then
      new.author_id := auth.uid();
      new.created_at := now();
      new.edited_at := null;
    else
      new.author_id := coalesce(new.author_id, auth.uid());
    end if;
    return new;
  end if;

  new.created_at := old.created_at;
  if api then
    new.author_id := old.author_id;
    new.edited_at := case
      when (new.body, new.mentions) is distinct from (old.body, old.mentions) then now()
      else old.edited_at
    end;
  end if;
  return new;
end;
$$;

-- A comment lives in its record's workspace and never moves to another record
-- (definer: the fence then judges the result, so a demo caller can't comment
-- on a live record). Mentions are cleaned here, for every path.
create or replace function private.comment_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and (new.lead_id, new.client_id, new.invoice_id, new.todo_id)
         is distinct from (old.lead_id, old.client_id, old.invoice_id, old.todo_id) then
    raise exception 'A comment can''t move to another record.' using errcode = 'check_violation';
  end if;

  new.workspace := case
    when new.lead_id is not null then (select l.workspace from public.leads l where l.id = new.lead_id)
    when new.client_id is not null then (select c.workspace from public.clients c where c.id = new.client_id)
    when new.invoice_id is not null then (select i.workspace from public.invoices i where i.id = new.invoice_id)
    when new.todo_id is not null then (select t.workspace from public.todos t where t.id = new.todo_id)
  end;
  if new.workspace is null then
    raise exception 'That record doesn''t exist.' using errcode = 'foreign_key_violation';
  end if;

  if tg_op = 'INSERT' or new.mentions is distinct from old.mentions then
    new.mentions := private.comment_audience(new, new.mentions);
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_comments(), private.comment_workspace() from public, anon, authenticated;

drop trigger if exists comments_guard on public.comments;
create trigger comments_guard
  before insert or update on public.comments
  for each row execute function private.guard_comments();

drop trigger if exists comments_workspace on public.comments;
create trigger comments_workspace
  before insert or update on public.comments
  for each row execute function private.comment_workspace();

-- ──────────────────────────── notifications ────────────────────────────────
-- Alerts carry the comment as their entity, so deleting it (or dropping a
-- mention) can take back what nobody has read yet. The author is the actor,
-- so they never hear about their own words.
create or replace function private.notify_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx       record;
  who       text;
  snippet   text;
  mentioned uuid[];
  others    uuid[];
begin
  if tg_op = 'DELETE' then
    delete from public.notifications
    where entity_type = 'comment' and entity_id = old.id
      and type in ('mention', 'comment') and read_at is null;
    return null;
  end if;

  if tg_op = 'UPDATE' then
    -- Un-mentioned: their unread alert goes. Newly mentioned: told below.
    delete from public.notifications
    where entity_type = 'comment' and entity_id = new.id and type = 'mention' and read_at is null
      and not (recipient_id = any (new.mentions));
    mentioned := array(select m from unnest(new.mentions) m where not (m = any (old.mentions)));
    if cardinality(mentioned) = 0 then
      return null;
    end if;
  else
    mentioned := new.mentions;
  end if;

  ctx := private.comment_parent(new);
  select coalesce(nullif(btrim(p.full_name), ''), p.email) into who from public.profiles p where p.id = new.author_id;
  snippet := regexp_replace(btrim(new.body), '\s+', ' ', 'g');
  snippet := case when length(snippet) > 160 then left(snippet, 159) || '…' else snippet end;

  perform private.notify(
    mentioned,
    new.workspace,
    'mention',
    format('%s mentioned you · %s', coalesce(who, 'Someone'), coalesce(ctx.label, ctx.kind)),
    snippet,
    ctx.link,
    'comment', new.id,
    now(),
    new.author_id
  );

  if tg_op = 'INSERT' then
    -- Everyone else involved: the record's people and earlier commenters.
    others := private.comment_audience(new, ctx.involved || array(
      select c.author_id from public.comments c
      where c.id <> new.id
        and c.author_id is not null
        and ((new.lead_id is not null and c.lead_id = new.lead_id)
          or (new.client_id is not null and c.client_id = new.client_id)
          or (new.invoice_id is not null and c.invoice_id = new.invoice_id)
          or (new.todo_id is not null and c.todo_id = new.todo_id))
      order by c.created_at
    ));
    others := array(select o from unnest(others) o where not (o = any (mentioned)));

    perform private.notify(
      others,
      new.workspace,
      'comment',
      format('%s commented · %s', coalesce(who, 'Someone'), coalesce(ctx.label, ctx.kind)),
      snippet,
      ctx.link,
      'comment', new.id,
      now(),
      new.author_id
    );
  end if;
  return null;
end;
$$;

revoke execute on function private.notify_comment() from public, anon, authenticated;

drop trigger if exists comments_notify on public.comments;
create trigger comments_notify
  after insert or update or delete on public.comments
  for each row execute function private.notify_comment();

-- ───────────────────────────── activity log ────────────────────────────────
-- Logged against the record, so the line links to it. Comments that leave
-- with their record (the cascade) are part of that deletion; private to-dos
-- stay out of the trail (the super admin isn't a participant).
create or replace function private.log_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r   public.comments := coalesce(new, old);
  ctx record;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  ctx := private.comment_parent(r);
  if ctx.label is null or ctx.is_private then
    return null;
  end if;

  -- Quotes are logged as invoices everywhere else (0013); the summary still says quote.
  perform private.log_event(
    r.workspace,
    case when tg_op = 'INSERT' then 'commented' else 'comment_deleted' end,
    case when ctx.kind = 'quote' then 'invoice' else ctx.kind end, ctx.record_id, ctx.label,
    format(case when tg_op = 'INSERT' then 'commented on %s “%s”' else 'deleted a comment on %s “%s”' end,
           ctx.kind, left(ctx.label, 80))
  );
  return null;
end;
$$;

revoke execute on function private.log_comment() from public, anon, authenticated;

drop trigger if exists comments_activity on public.comments;
create trigger comments_activity
  after insert or delete on public.comments
  for each row execute function private.log_comment();

-- ───────────────────────────── policies ────────────────────────────────────
alter table public.comments enable row level security;

drop policy if exists "workspace fence" on public.comments;
create policy "workspace fence" on public.comments as restrictive for all to authenticated
  using (workspace = (select public.current_workspace()) and (select public.is_active_member()))
  with check (workspace = (select public.current_workspace()) and (select public.is_active_member()));

-- The record as the caller sees it, under its own RLS (none of those policies
-- look back at comments, so nothing recurses).
drop policy if exists "comments: read with the record" on public.comments;
create policy "comments: read with the record"
  on public.comments for select to authenticated
  using (
    case
      when comments.lead_id is not null then exists (select 1 from public.leads l where l.id = comments.lead_id)
      when comments.client_id is not null then exists (select 1 from public.clients c where c.id = comments.client_id)
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
      when comments.client_id is not null then exists (select 1 from public.clients c where c.id = comments.client_id)
      when comments.invoice_id is not null then exists (select 1 from public.invoices i where i.id = comments.invoice_id)
      else exists (select 1 from public.todos t where t.id = comments.todo_id)
    end
  );

-- Your own words, on a record you can still see.
drop policy if exists "comments: author edits" on public.comments;
create policy "comments: author edits"
  on public.comments for update to authenticated
  using (
    author_id = (select auth.uid())
    and case
      when comments.lead_id is not null then exists (select 1 from public.leads l where l.id = comments.lead_id)
      when comments.client_id is not null then exists (select 1 from public.clients c where c.id = comments.client_id)
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
      when comments.client_id is not null then exists (select 1 from public.clients c where c.id = comments.client_id)
      when comments.invoice_id is not null then exists (select 1 from public.invoices i where i.id = comments.invoice_id)
      else exists (select 1 from public.todos t where t.id = comments.todo_id)
    end
  );

-- Table-level grants beat column grants, so revoke first. An edit changes the
-- words and the mentions (edited_at is accepted but stamped by the database).
revoke all on public.comments from anon;
revoke update on public.comments from authenticated;
grant update (body, mentions, edited_at) on public.comments to authenticated;
