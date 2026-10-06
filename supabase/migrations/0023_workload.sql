-- ============================================================================
-- 0023 · Workload
-- Who's carrying what in a week, one row per active teammate (super admin,
-- admin, member) in the caller's workspace:
--   · to-dos they answer for — the ones they're tagged on, plus their own
--     that nobody is tagged on (the same people a reminder goes to, 0020):
--     open, overdue, and due in the week (open ones, by Colombo day);
--   · meeting hours — timed events of kind 'meeting' they created or attend,
--     cut into Colombo days (an event with no end counts as an hour);
--   · what they own — open leads (not in a won or lost stage) and their value,
--     clients they manage (not archived), and the balance left on their
--     issued LKR invoices (the figure reads in Rs like the pipeline value;
--     amounts in other currencies can't be added into it);
--   · leave — approved time off, full or half days, per day of the week.
--     Working from home is still working, so it doesn't count.
--
-- Returns {team, people}: people is one row per teammate; team counts the
-- to-dos across them once each — a to-do two people share is one to-do for
-- the team, where adding up the rows would count it twice.
--
-- Aggregates only, so team_workload() is security definer: a member with the
-- Workload module sees everyone's counts without reading their to-dos, leads
-- or invoices. It checks can_access('workload') itself and only reads the
-- caller's workspace — the demo sees its fictional team, never the live one.
-- Private to-dos count toward their people's load (a number, never a title).
-- Requires: 0022
-- ============================================================================

create or replace function public.team_workload(p_week_start date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ws text := public.current_workspace();
  -- No week given: this one, from Monday.
  d0 date := coalesce(p_week_start, public.local_today() - (extract(isodow from public.local_today())::integer - 1));
  -- The week as Colombo wall-clock moments, for timed events.
  t0 timestamptz := private.local_at(d0, '00:00');
  t1 timestamptz := private.local_at(d0 + 7, '00:00');
begin
  if not public.can_access('workload') then
    raise exception 'You don''t have access to Workload.' using errcode = '42501';
  end if;

  return (
    with people as (
      select p.id, coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)) as name, p.title
      from public.profiles p
      where p.workspace = ws and p.is_active and p.role in ('super_admin', 'admin', 'member')
    ),
    days as (
      select g.d::date as day,
             private.local_at(g.d::date, '00:00') as day_start,
             private.local_at(g.d::date + 1, '00:00') as day_end
      from generate_series(d0::timestamp, (d0 + 6)::timestamp, interval '1 day') as g(d)
    ),
    -- One row per person and open to-do they answer for.
    duty as (
      select a.user_id, t.id, t.due_at, t.all_day
      from public.todos t
      join public.todo_assignees a on a.todo_id = t.id
      where t.workspace = ws and t.status <> 'done'
      union
      select t.created_by, t.id, t.due_at, t.all_day
      from public.todos t
      where t.workspace = ws and t.status <> 'done' and t.created_by is not null
        and not exists (select 1 from public.todo_assignees a where a.todo_id = t.id)
    ),
    dated as (
      select u.user_id, u.id,
             (u.due_at at time zone 'Asia/Colombo')::date as due_day,
             case when u.all_day then (u.due_at at time zone 'Asia/Colombo')::date < public.local_today()
                  else u.due_at < now() end as overdue
      from duty u
    ),
    todo_load as (
      select x.user_id,
             count(*)                                               as open_n,
             count(*) filter (where x.overdue)                      as overdue_n,
             count(*) filter (where x.due_day between d0 and d0 + 6) as week_n
      from dated x
      group by x.user_id
    ),
    meetings as (
      select e.id, e.created_by, e.starts_at, coalesce(e.ends_at, e.starts_at + interval '1 hour') as ends_at
      from public.calendar_events e
      where e.workspace = ws and e.kind = 'meeting' and not e.all_day
        and e.starts_at < t1 and coalesce(e.ends_at, e.starts_at + interval '1 hour') > t0
    ),
    attending as (
      select m.id, m.created_by as user_id, m.starts_at, m.ends_at from meetings m where m.created_by is not null
      union
      select m.id, a.user_id, m.starts_at, m.ends_at
      from meetings m join public.calendar_event_attendees a on a.event_id = m.id
    ),
    meeting_days as (
      select x.user_id, dy.day,
             sum(extract(epoch from least(x.ends_at, dy.day_end) - greatest(x.starts_at, dy.day_start)) / 3600) as hours
      from attending x
      join days dy on x.starts_at < dy.day_end and x.ends_at > dy.day_start
      group by x.user_id, dy.day
    ),
    -- Two half days on the same day make a full one.
    leave_days as (
      select o.user_id, dy.day,
             case when bool_or(o.half_day is null) or count(distinct o.half_day) > 1 then 'full'
                  else min(o.half_day) end as leave
      from public.time_off o
      join days dy on dy.day between o.starts_on and o.ends_on
      where o.workspace = ws and o.status = 'approved' and o.type <> 'wfh'
      group by o.user_id, dy.day
    ),
    lead_load as (
      select l.owner_id as user_id, count(*) as n, sum(l.value) as value
      from public.leads l
      join public.pipeline_stages s on s.id = l.stage_id
      where l.workspace = ws and l.owner_id is not null and not s.is_won and not s.is_lost
      group by l.owner_id
    ),
    client_load as (
      select c.account_manager_id as user_id, count(*) as n
      from public.clients c
      where c.workspace = ws and c.account_manager_id is not null and c.status <> 'archived'
      group by c.account_manager_id
    ),
    invoice_load as (
      select i.owner_id as user_id, sum(i.balance_due) as owed
      from public.invoices i
      where i.workspace = ws
        and i.kind = 'invoice'
        and i.status in ('issued', 'partially_paid')
        and i.owner_id is not null
        and i.currency = 'LKR'
      group by i.owner_id
    ),
    team_load as (
      select count(distinct x.id)                                                as open_n,
             count(distinct x.id) filter (where x.overdue)                       as overdue_n,
             count(distinct x.id) filter (where x.due_day between d0 and d0 + 6) as week_n
      from dated x
      where x.user_id in (select p.id from people p)
    ),
    rows_ as (
      select jsonb_agg(jsonb_build_object(
               'user_id',           p.id,
               'full_name',         p.name,
               'title',             p.title,
               'open_todos',        coalesce(tl.open_n, 0),
               'overdue_todos',     coalesce(tl.overdue_n, 0),
               'due_this_week',     coalesce(tl.week_n, 0),
               'meeting_hours',     coalesce((select round(sum(m.hours), 2) from meeting_days m where m.user_id = p.id), 0),
               'leads_owned',       coalesce(ll.n, 0),
               'pipeline_value',    coalesce(ll.value, 0),
               'clients_managed',   coalesce(cl.n, 0),
               'outstanding_owned', coalesce(il.owed, 0),
               'leave_days',        coalesce((select sum(case lv.leave when 'full' then 1 else 0.5 end)
                                              from leave_days lv where lv.user_id = p.id), 0),
               'days',              (
                 select jsonb_agg(jsonb_build_object(
                          'date',          dy.day,
                          'todos_due',     (select count(*) from dated x where x.user_id = p.id and x.due_day = dy.day),
                          'meeting_hours', coalesce((select round(m.hours, 2) from meeting_days m
                                                     where m.user_id = p.id and m.day = dy.day), 0),
                          'leave',         (select lv.leave from leave_days lv where lv.user_id = p.id and lv.day = dy.day)
                        ) order by dy.day)
                 from days dy
               )
             ) order by lower(p.name), p.id) as list
      from people p
      left join todo_load tl on tl.user_id = p.id
      left join lead_load ll on ll.user_id = p.id
      left join client_load cl on cl.user_id = p.id
      left join invoice_load il on il.user_id = p.id
    )
    select jsonb_build_object(
             'team',   jsonb_build_object('open_todos',    t.open_n,
                                          'overdue_todos', t.overdue_n,
                                          'due_this_week', t.week_n),
             'people', coalesce(r.list, '[]'::jsonb))
    from rows_ r, team_load t
  );
end;
$$;

revoke execute on function public.team_workload(date) from public, anon, authenticated;
grant execute on function public.team_workload(date) to authenticated, service_role;
