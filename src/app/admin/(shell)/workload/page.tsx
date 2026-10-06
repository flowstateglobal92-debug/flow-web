import Link from "next/link";
import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { addDays, num, todayISO } from "@/lib/admin/format";
import { canAccess } from "@/lib/admin/modules";
import { Icon } from "@/components/admin/icons";
import { EmptyState, Notice, PageHead, Panel, Stat } from "@/components/admin/ui";
import { dayLong, dayShort, isDay, startOfWeek } from "@/components/admin/calendar/items";
import WorkloadRow, { loadOf, type WorkloadData } from "./WorkloadRow";

export const metadata: Metadata = { title: "Workload" };

/**
 * Who's carrying what in a week — to-dos, meetings, leave and what each
 * person owns. Aggregates come from the definer RPC team_workload() (0023),
 * so a member with Workload sees totals without row access to the modules
 * behind them. ?week=YYYY-MM-DD (any day; snapped to its Monday).
 */
export default async function WorkloadPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { supabase, profile } = await requireModule("workload");
  const params = await searchParams;

  const today = todayISO();
  const thisWeek = startOfWeek(today);
  const week = isDay(params.week) ? startOfWeek(params.week) : thisWeek;

  const { data, error } = await supabase.rpc("team_workload", { p_week_start: week });
  const result = (data ?? null) as WorkloadData | null;
  const people = result && Array.isArray(result.people) ? result.people : [];
  const canTodos = canAccess(profile, "todos");

  // To-dos from the team's own count: a to-do two people share is one to-do,
  // where adding up the rows below would count it for each of them.
  const totals = {
    open: num(result?.team?.open_todos),
    overdue: num(result?.team?.overdue_todos),
    due: num(result?.team?.due_this_week),
    out: people.filter((p) => num(p.leave_days) > 0).length,
    heavy: people.filter((p) => loadOf(p).level === "heavy").length,
  };

  const weekHref = (day: string) => (day === thisWeek ? "/admin/workload" : `/admin/workload?week=${day}`);
  const navLink =
    "inline-flex min-h-9 items-center gap-1.5 border border-cream/12 bg-cream/[0.03] px-3 text-[12px] font-medium text-cream-2 transition-colors hover:border-cream/30 hover:text-cream sm:min-h-0 sm:py-1.5";

  return (
    <>
      <PageHead
        eyebrow={week === thisWeek ? "This week" : `Week of ${dayLong(week)}`}
        title="Workload"
        hint="Who's carrying what — to-dos, meetings, leave and what each person owns. Pick someone to see their to-dos."
        actions={
          <>
            <Link href={weekHref(addDays(week, -7))} className={navLink} aria-label="Previous week">
              <Icon.chevronLeft size={13} /> <span className="hidden sm:inline">Previous</span>
            </Link>
            <span className="min-w-0 px-1 font-mono text-[11.5px] text-cream-2 tabular-nums">
              {dayShort(week)} – {dayShort(addDays(week, 6))}
            </span>
            <Link href={weekHref(addDays(week, 7))} className={navLink} aria-label="Next week">
              <span className="hidden sm:inline">Next</span> <Icon.chevronRight size={13} />
            </Link>
            {week !== thisWeek && (
              <Link href="/admin/workload" className={navLink}>
                This week
              </Link>
            )}
          </>
        }
      />

      {error ? (
        <Notice tone="warn" title="Workload isn't available yet">
          It needs migration 0023 (team_workload) on the database. {error.message}
        </Notice>
      ) : people.length === 0 ? (
        <EmptyState title="No one to show" hint="Active members and admins appear here once they're on the team." />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Open to-dos"
              value={totals.open}
              sub={`${totals.due} due this week · shared ones count once`}
              icon={<Icon.checklist size={15} />}
            />
            <Stat
              label="Overdue to-dos"
              value={totals.overdue}
              sub={totals.overdue ? "Across the team" : "Nothing has slipped"}
              tone={totals.overdue ? "danger" : "neutral"}
              icon={<Icon.flag size={15} />}
            />
            <Stat
              label="Out this week"
              value={totals.out}
              sub={totals.out === 1 ? "person has leave booked" : "people have leave booked"}
              icon={<Icon.plane size={15} />}
            />
            <Stat
              label="Heavy load"
              value={totals.heavy}
              sub="By the heuristic below"
              tone={totals.heavy ? "terra" : "neutral"}
              icon={<Icon.scale size={15} />}
            />
          </div>

          <Panel title="Team" hint={`${people.length} ${people.length === 1 ? "person" : "people"} · Mon–Sun`} bodyClass="p-0">
            <ul>
              {people.map((p) => (
                <WorkloadRow key={p.user_id} person={p} today={today} href={canTodos ? `/admin/todos?assignee=${encodeURIComponent(p.user_id)}` : null} />
              ))}
            </ul>
          </Panel>

          <p className="mt-3 max-w-3xl text-[11.5px] leading-relaxed text-sand">
            <span className="font-mono uppercase tracking-[0.12em] text-cream-2">Load is a heuristic</span> — a rough
            read, not a measure. It counts to-dos due this week, plus overdue ones, plus meeting hours ÷ 2, per working
            day the person is in (leave takes days out; a half day counts as half). Under 1 a day reads light, 1–2.5
            balanced, over 2.5 heavy. Bars in each day show to-dos due (terra) and meeting hours (cream); hatched days
            are leave.
          </p>
        </>
      )}
    </>
  );
}
