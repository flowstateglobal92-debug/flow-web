import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireModule, type Session } from "@/lib/admin/auth";
import { loadCalendarItems } from "@/lib/admin/calendar-feed";
import { hrefFor } from "@/lib/admin/links";
import { canAccess, isApprover } from "@/lib/admin/modules";
import { monthlyValue, scheduleEnded, type Frequency } from "@/lib/admin/invoice-types";
import { displayName, loadTeam } from "@/lib/admin/team";
import type { CalendarItem, FinanceTotals, Inquiry, Lead, Stage, TeamMember } from "@/lib/admin/types";
import {
  APP_TIMEZONE,
  addDays,
  formatDateShort,
  formatTime,
  money,
  moneyShort,
  num,
  relativeTime,
  toDateInput,
  todayISO,
} from "@/lib/admin/format";
import CalendarView from "@/components/admin/calendar/CalendarView";
import { dayKey, dayShort, gridRange, isUnscheduled } from "@/components/admin/calendar/items";
import { Icon } from "@/components/admin/icons";
import { Avatar, AvatarStack, EmptyState, Panel, PageHead, Stat } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Dashboard" };

type Supa = Session["supabase"];

/**
 * Today at a glance. Every widget is gated on its own module (or on being an
 * approver), and only the queries for widgets the viewer can see run. A
 * feature whose migration hasn't been applied reads as empty, never as an
 * error — Supabase returns `{ data: null, error }` rather than throwing.
 */
export default async function DashboardPage() {
  const { supabase, profile } = await requireModule("dashboard");
  const can = (k: Parameters<typeof canAccess>[1]) => canAccess(profile, k);

  const today = todayISO();
  const month = today.slice(0, 7);
  // The whole month grid, spill-over weeks included — the same range the calendar page loads.
  const range = gridRange(month);
  const endOfToday = `${addDays(today, 1)}T00:00:00+05:30`;

  const show = {
    inquiries: can("inquiries"),
    pipeline: can("crm"),
    books: can("finance"),
    invoices: can("invoices"),
    approvals: isApprover(profile),
    out: can("calendar") || can("workload"),
    todos: can("todos"),
    calendar: can("calendar"),
  };
  const needTeam = show.approvals || show.out || show.calendar;

  const [inquiries, pipeline, books, budgets, invoices, approvals, out, todos, calendar, team] = await Promise.all([
    show.inquiries ? loadInquiries(supabase) : null,
    show.pipeline ? loadPipeline(supabase) : null,
    show.books ? loadBooks(supabase, `${month}-01`) : null,
    show.books ? loadBudgetAlerts(supabase) : null,
    show.invoices ? loadInvoices(supabase) : null,
    show.approvals ? loadApprovals(supabase, profile.id) : null,
    show.out ? loadWhosOut(supabase, today) : null,
    show.todos ? loadMyTodos(supabase, profile.id, endOfToday) : null,
    show.calendar ? loadCalendarItems(supabase, profile, range.from, range.to).catch(() => []) : null,
    needTeam ? loadTeam(supabase) : ([] as TeamMember[]),
  ]);

  const nameFor = (id: string | null) => displayName(team.find((t) => t.id === id));

  /* ── the KPI strip: one number from each area the viewer can open ── */
  const stats: ReactNode[] = [];
  if (inquiries) {
    stats.push(
      <Stat
        key="inquiries"
        label="New inquiries"
        value={inquiries.fresh}
        sub={inquiries.fresh ? "Waiting on a first reply" : "Inbox is clear"}
        tone={inquiries.fresh ? "terra" : "neutral"}
        icon={<Icon.inbox size={15} />}
      />,
    );
  }
  if (pipeline) {
    stats.push(
      <Stat
        key="pipeline"
        label="Open pipeline"
        value={moneyShort(pipeline.openValue)}
        sub={`${pipeline.openCount} live leads · ${moneyShort(pipeline.wonValue)} won`}
        icon={<Icon.pipeline size={15} />}
      />,
    );
  }
  if (invoices) {
    const k = invoices.kpis;
    stats.push(
      <Stat
        key="outstanding"
        label="Outstanding"
        value={short(k.outstanding_total, k.currency)}
        sub={
          k.overdue_count
            ? `${short(k.overdue_total, k.currency)} overdue · ${k.overdue_count} ${k.overdue_count === 1 ? "invoice" : "invoices"}`
            : `${k.outstanding_count} open ${k.outstanding_count === 1 ? "invoice" : "invoices"}, none overdue`
        }
        tone={k.overdue_count ? "danger" : "neutral"}
        icon={<Icon.receipt size={15} />}
      />,
      <Stat
        key="mrr"
        label="MRR"
        value={short(invoices.mrr, invoices.mrrCurrency)}
        sub={
          invoices.retainers
            ? `${invoices.retainers} active ${invoices.retainers === 1 ? "retainer" : "retainers"}, per month`
            : "No active retainers"
        }
        tone={invoices.mrr > 0 ? "success" : "neutral"}
        icon={<Icon.repeat size={15} />}
      />,
    );
  }
  if (books) {
    stats.push(
      <Stat
        key="profit"
        label={books.profit < 0 ? "Net loss" : "Net profit"}
        value={money(books.profit)}
        sub={`${books.monthProfit < 0 ? "−" : "+"}${moneyShort(Math.abs(books.monthProfit))} this month`}
        tone={books.profit < 0 ? "danger" : "success"}
        icon={<Icon.ledger size={15} />}
      />,
    );
  }
  if (approvals) {
    stats.push(
      <Stat
        key="approvals"
        label="Pending approvals"
        value={approvals.count}
        sub={approvals.count ? "Waiting on your decision" : "Nothing waiting on you"}
        tone={approvals.count ? "terra" : "neutral"}
        icon={<Icon.shield size={15} />}
      />,
    );
  }

  /* ── the wide column ── */
  const main: ReactNode[] = [];
  if (calendar) {
    main.push(
      <CalendarView
        key="calendar"
        initialItems={calendar}
        initialMonth={month}
        people={team}
        me={profile.id}
        variant="compact"
      />,
    );
  }
  if (pipeline) main.push(<PipelinePanel key="pipeline" pipeline={pipeline} />);

  /* ── the side rail ── */
  const side: ReactNode[] = [];
  if (todos) side.push(<MyTodosPanel key="todos" todos={todos} today={today} />);
  if (calendar) side.push(<UpNextPanel key="next" items={upNext(calendar, profile.id)} today={today} />);
  if (out) side.push(<WhosOutPanel key="out" out={out} nameFor={nameFor} />);
  if (approvals) side.push(<ApprovalsPanel key="approvals" approvals={approvals} nameFor={nameFor} />);
  if (budgets) side.push(<BudgetPanel key="budgets" alerts={budgets} />);
  if (inquiries) side.push(<InquiriesPanel key="inquiries" latest={inquiries.latest} />);

  const firstName = (profile.full_name ?? profile.email).split(/[\s@]/)[0];

  return (
    <>
      <PageHead
        eyebrow={new Intl.DateTimeFormat("en-GB", {
          timeZone: APP_TIMEZONE,
          weekday: "long",
          day: "numeric",
          month: "long",
        }).format(new Date())}
        title={`Good to see you, ${firstName.charAt(0).toUpperCase() + firstName.slice(1)}`}
        hint="What's due, who's out, and the numbers you look after — at a glance."
      />

      {stats.length > 0 && (
        <div className={`mb-5 grid grid-cols-1 gap-3 ${STAT_COLS[Math.min(stats.length, 6)]}`}>{stats}</div>
      )}

      {main.length > 0 && side.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">{main}</div>
          <div className="flex min-w-0 flex-col gap-4">{side}</div>
        </div>
      ) : main.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-4">{main}</div>
      ) : side.length > 0 ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {side.map((node, i) => (
            <div key={i} className="min-w-0">
              {node}
            </div>
          ))}
        </div>
      ) : (
        stats.length === 0 && (
          <EmptyState
            title="Your dashboard fills in as modules open up"
            hint="Each widget follows a module you have — ask the super admin to tick the ones you need in Team & Users."
          />
        )
      )}
    </>
  );
}

const STAT_COLS: Record<number, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
  5: "sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5",
  6: "sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6",
};

/** KPI tiles: compact rupees, or the full figure with its symbol for another currency. */
const short = (value: number, code: string) => (code === "LKR" ? moneyShort(value) : money(value, { code }));

/* ─────────────────────────────── loaders ───────────────────────────────── */

async function loadInquiries(supabase: Supa) {
  const [{ count }, { data }] = await Promise.all([
    supabase.from("inquiries").select("id", { count: "exact", head: true }).eq("status", "new"),
    supabase
      .from("inquiries")
      .select("id, name, business, contact, status, created_at")
      .order("created_at", { ascending: false })
      .limit(5)
      .returns<Pick<Inquiry, "id" | "name" | "business" | "contact" | "status" | "created_at">[]>(),
  ]);
  return { fresh: count ?? 0, latest: data ?? [] };
}

type PipelineData = Awaited<ReturnType<typeof loadPipeline>>;

async function loadPipeline(supabase: Supa) {
  const [{ data: stages }, { data: leads }] = await Promise.all([
    supabase
      .from("pipeline_stages")
      .select("id, name, slug, position, tone, is_protected, is_won, is_lost")
      .order("position", { ascending: true })
      .returns<Stage[]>(),
    supabase.from("leads").select("id, stage_id, value").returns<Pick<Lead, "id" | "stage_id" | "value">[]>(),
  ]);
  const stageList = stages ?? [];
  const leadList = leads ?? [];
  const isOpen = new Set(stageList.filter((s) => !s.is_won && !s.is_lost).map((s) => s.id));
  const isWon = new Set(stageList.filter((s) => s.is_won).map((s) => s.id));
  const sum = (ids: Set<string>) => leadList.filter((l) => ids.has(l.stage_id)).reduce((a, l) => a + num(l.value), 0);
  return {
    stages: stageList.map((s) => {
      const inStage = leadList.filter((l) => l.stage_id === s.id);
      return { ...s, count: inStage.length, value: inStage.reduce((a, l) => a + num(l.value), 0) };
    }),
    openValue: sum(isOpen),
    openCount: leadList.filter((l) => isOpen.has(l.stage_id)).length,
    wonValue: sum(isWon),
  };
}

async function loadBooks(supabase: Supa, monthStart: string) {
  // The finance views count approved entries only once approvals (0016) land.
  const [{ data: totals }, { data: thisMonth }] = await Promise.all([
    supabase.from("finance_totals").select("income, expense, profit, entries").maybeSingle<FinanceTotals>(),
    supabase.from("finance_monthly").select("profit").eq("month", monthStart).maybeSingle<{ profit: number }>(),
  ]);
  return { profit: num(totals?.profit), monthProfit: num(thisMonth?.profit) };
}

type BudgetAlert = { id: string; category: string; period: string; amount: number; spent: number; pct: number; alert: number };

async function loadBudgetAlerts(supabase: Supa): Promise<BudgetAlert[]> {
  const { data } = await supabase
    .from("budget_status")
    .select("id, category, period, amount, alert_percent, spent")
    .eq("active", true)
    .returns<{ id: string; category: string; period: string; amount: number; alert_percent: number; spent: number }[]>();
  return (data ?? [])
    .map((b) => {
      const amount = num(b.amount);
      const spent = num(b.spent);
      return {
        id: b.id,
        category: b.category,
        period: b.period,
        amount,
        spent,
        pct: amount > 0 ? (spent / amount) * 100 : 0,
        alert: num(b.alert_percent, 80),
      };
    })
    .filter((b) => b.pct >= b.alert)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);
}

type InvoiceKpis = {
  outstanding_total: number;
  outstanding_count: number;
  overdue_total: number;
  overdue_count: number;
  currency: string;
};

type RetainerRow = {
  amount: number;
  currency: string;
  frequency: Frequency;
  interval_count: number;
  ends_on: string | null;
  next_run_on: string;
  occurrences: number;
  max_occurrences: number | null;
};

/** MRR is counted in rupees, as on Invoices → Recurring, so the two figures agree. */
const MRR_CURRENCY = "LKR";

async function loadInvoices(supabase: Supa) {
  const [{ data: kpis }, { data: schedules }] = await Promise.all([
    supabase.rpc("invoice_kpis"),
    supabase
      .from("invoice_schedules")
      .select("amount, currency, frequency, interval_count, ends_on, next_run_on, occurrences, max_occurrences")
      .eq("active", true)
      .eq("is_retainer", true)
      .returns<RetainerRow[]>(),
  ]);
  const k = (kpis ?? {}) as Partial<InvoiceKpis>;
  const currency = k.currency || "LKR";

  // The Recurring tab's rule: a schedule that has run its course (end date or
  // occurrence cap) stops counting even while it's still switched on.
  // Retainers in other currencies aren't converted — they're left out.
  const running = (schedules ?? []).filter(
    (s) => !scheduleEnded(s) && (s.currency || "LKR").toUpperCase() === MRR_CURRENCY,
  );
  const mrr = running.reduce((a, s) => a + monthlyValue(num(s.amount), s.frequency, num(s.interval_count, 1)), 0);

  return {
    kpis: {
      outstanding_total: num(k.outstanding_total),
      outstanding_count: num(k.outstanding_count),
      overdue_total: num(k.overdue_total),
      overdue_count: num(k.overdue_count),
      currency,
    },
    mrr: Math.round(mrr),
    mrrCurrency: MRR_CURRENCY,
    retainers: running.length,
  };
}

type Approval = {
  id: string;
  entity_type: string;
  summary: string;
  amount: number | null;
  currency: string | null;
  requested_by: string | null;
  created_at: string;
};

async function loadApprovals(supabase: Supa, me: string) {
  const { data, count } = await supabase
    .from("approval_requests")
    .select("id, entity_type, summary, amount, currency, requested_by, created_at", { count: "exact" })
    .eq("status", "pending")
    // A request whose requester was deleted still needs deciding (neq drops nulls).
    .or(`requested_by.is.null,requested_by.neq.${me}`)
    .order("created_at", { ascending: false })
    .limit(5)
    .returns<Approval[]>();
  return { count: count ?? 0, items: data ?? [] };
}

type Leave = { id: string; user_id: string; type: string; half_day: "am" | "pm" | null; status: string };

async function loadWhosOut(supabase: Supa, today: string) {
  const { data } = await supabase
    .from("time_off")
    .select("id, user_id, type, half_day, status")
    .lte("starts_on", today)
    .gte("ends_on", today)
    .in("status", ["approved", "pending"])
    .order("starts_on", { ascending: true })
    .returns<Leave[]>();
  return data ?? [];
}

type MyTodo = { id: string; title: string; due_at: string; all_day: boolean; priority: string };

async function loadMyTodos(supabase: Supa, me: string, endOfToday: string) {
  // Same rule as the nav badge: tagged on me, not done, due by the end of today.
  const { data, count } = await supabase
    .from("todos")
    .select("id, title, due_at, all_day, priority, todo_assignees!inner(user_id)", { count: "exact" })
    .eq("todo_assignees.user_id", me)
    .neq("status", "done")
    .lt("due_at", endOfToday)
    .order("due_at", { ascending: true })
    .limit(8)
    .returns<MyTodo[]>();
  return { count: count ?? 0, items: data ?? [] };
}

/* ─────────────────────────────── widgets ───────────────────────────────── */

function ViewAll({ href, label = "View all" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="text-[11.5px] text-sand transition-colors hover:text-cream">
      {label}
    </Link>
  );
}

function MyTodosPanel({ todos, today }: { todos: { count: number; items: MyTodo[] }; today: string }) {
  const now = new Date().getTime();
  const rows = todos.items.map((t) => {
    const day = toDateInput(new Date(t.due_at));
    const overdue = t.all_day ? day < today : new Date(t.due_at).getTime() < now;
    const when = day < today ? formatDateShort(t.due_at) : t.all_day ? "Today" : `Today · ${formatTime(t.due_at)}`;
    return { ...t, overdue, when };
  });
  const overdue = rows.filter((r) => r.overdue).length;

  return (
    <Panel
      title="My to-dos"
      hint={
        todos.count === 0
          ? "Nothing due today"
          : todos.count > rows.length
            ? `${todos.count} due today or overdue`
            : overdue
              ? `${overdue} overdue · ${todos.count - overdue} due today`
              : `${todos.count} due today`
      }
      bodyClass="p-0"
      right={<ViewAll href="/admin/todos" label="Open" />}
    >
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-sand">You&apos;re clear for today.</p>
      ) : (
        <ul>
          {rows.map((t) => (
            <li key={t.id}>
              <Link
                href={hrefFor("todo", t.id) ?? "/admin/todos"}
                className="flex items-start gap-3 border-b border-cream/[0.05] px-4 py-3 transition-colors hover:bg-cream/[0.04]"
              >
                <span className={`mt-0.5 shrink-0 ${t.overdue ? "text-bad-300" : "text-terra-bright"}`}>
                  <Icon.checklist size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-cream">{t.title}</span>
                  <span className={`block font-mono text-[10.5px] ${t.overdue ? "text-bad-300" : "text-sand"}`}>
                    {t.overdue ? `Overdue · ${t.when}` : t.when}
                    {(t.priority === "urgent" || t.priority === "high") && (
                      <span className="text-terra-bright"> · {t.priority}</span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          ))}
          {todos.count > rows.length && (
            <li className="px-4 py-2.5 text-[11px] text-sand">+{todos.count - rows.length} more in To-dos</li>
          )}
        </ul>
      )}
    </Panel>
  );
}

/** The viewer's next few events and dated to-dos, from the items the calendar widget already loaded. */
function upNext(items: CalendarItem[], me: string) {
  const now = Date.now();
  const today = todayISO();
  return items
    .filter(
      (i) =>
        (i.kind === "event" || (i.kind === "todo" && !isUnscheduled(i))) &&
        !i.done &&
        (i.created_by === me || i.people.includes(me)) &&
        // Still ahead or under way: an all-day item counts through its last day.
        (i.all_day
          ? dayKey(i.ends_at ?? i.starts_at) >= today
          : new Date(i.ends_at ?? i.starts_at).getTime() >= now),
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 5);
}

function UpNextPanel({ items, today }: { items: CalendarItem[]; today: string }) {
  const dayWord = (day: string) =>
    day === today ? "Today" : day === addDays(today, 1) ? "Tomorrow" : day < today ? "Under way" : dayShort(day);
  return (
    <Panel
      title="Up next"
      hint={items.length ? "Your next events and to-dos" : "Nothing scheduled ahead"}
      bodyClass="p-0"
      right={<ViewAll href="/admin/calendar" label="Calendar" />}
    >
      {items.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-sand">Your calendar is clear.</p>
      ) : (
        <ul>
          {items.map((i) => {
            const when = dayWord(dayKey(i.starts_at));
            return (
              <li key={i.key}>
                <Link
                  href={i.href ?? hrefFor(i.kind === "event" ? "event" : "todo", i.id) ?? "/admin/calendar"}
                  className="flex items-start gap-3 border-b border-cream/[0.05] px-4 py-3 transition-colors last:border-0 hover:bg-cream/[0.04]"
                >
                  <span className="mt-0.5 shrink-0 text-terra-bright">
                    {i.kind === "event" ? <Icon.calendar size={14} /> : <Icon.checklist size={14} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-cream">{i.title}</span>
                    <span className="block font-mono text-[10.5px] text-sand">
                      {i.all_day ? when : `${when} · ${formatTime(i.starts_at)}`}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

const LEAVE_LABEL: Record<string, string> = {
  annual: "On leave",
  sick: "Sick",
  wfh: "Working from home",
  travel: "Travelling",
  other: "Out",
};

function WhosOutPanel({ out, nameFor }: { out: Leave[]; nameFor: (id: string | null) => string }) {
  return (
    <Panel
      title="Who's out today"
      hint={out.length ? `${out.length} ${out.length === 1 ? "person" : "people"} away or remote` : "Everyone's in"}
      bodyClass="p-0"
      right={out.length > 0 ? <AvatarStack names={out.map((o) => nameFor(o.user_id))} /> : undefined}
    >
      {out.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-sand">No leave on the calendar today.</p>
      ) : (
        <ul>
          {out.map((o) => (
            <li key={o.id} className="flex items-center gap-2.5 border-b border-cream/[0.05] px-4 py-2.5 last:border-0">
              <Avatar name={nameFor(o.user_id)} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-cream">{nameFor(o.user_id)}</span>
                <span className="block text-[10.5px] text-sand">
                  {LEAVE_LABEL[o.type] ?? "Out"}
                  {o.half_day ? ` · ${o.half_day === "am" ? "morning" : "afternoon"}` : ""}
                  {o.status === "pending" ? " · pending approval" : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const APPROVAL_NOUN: Record<string, string> = { expense: "Expense", invoice: "Invoice", time_off: "Leave" };

function ApprovalsPanel({
  approvals,
  nameFor,
}: {
  approvals: { count: number; items: Approval[] };
  nameFor: (id: string | null) => string;
}) {
  return (
    <Panel
      title="Pending approvals"
      hint={approvals.count ? "Members' requests waiting on an admin" : "Nothing waiting on you"}
      bodyClass="p-0"
      right={<ViewAll href="/admin/approvals" />}
    >
      {approvals.items.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-sand">All caught up.</p>
      ) : (
        <ul>
          {approvals.items.map((a) => (
            <li key={a.id}>
              <Link
                href={hrefFor("approval", a.id) ?? "/admin/approvals"}
                className="block border-b border-cream/[0.05] px-4 py-3 transition-colors last:border-0 hover:bg-cream/[0.04]"
              >
                <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-sand">
                  {APPROVAL_NOUN[a.entity_type] ?? "Request"} · {relativeTime(a.created_at)}
                </span>
                <span className="mt-0.5 block truncate text-[12.5px] text-cream">{a.summary}</span>
                <span className="block truncate text-[10.5px] text-sand">
                  {nameFor(a.requested_by)}
                  {a.amount != null ? ` · ${money(num(a.amount), { code: a.currency ?? "LKR" })}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function BudgetPanel({ alerts }: { alerts: BudgetAlert[] }) {
  return (
    <Panel
      title="Budget alerts"
      hint={alerts.length ? "Spending past its alert line" : "Every budget is under its alert line"}
      bodyClass="p-0"
      right={<ViewAll href="/admin/expenses/budgets" label="Budgets" />}
    >
      {alerts.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-sand">Nothing to flag this period.</p>
      ) : (
        <ul>
          {alerts.map((b) => {
            const over = b.pct >= 100;
            return (
              <li key={b.id} className="border-b border-cream/[0.05] px-4 py-2.5 last:border-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-[12px] text-cream-2">{b.category}</span>
                  <span
                    className={`shrink-0 font-mono text-[11px] tabular-nums ${over ? "text-bad-300" : "text-warn-200"}`}
                  >
                    {Math.round(b.pct)}%
                  </span>
                </div>
                <div className="mt-1.5 h-1 w-full bg-cream/[0.06]">
                  <div
                    className={`h-full ${over ? "bg-bad-400/80" : "bg-warn-300/80"}`}
                    style={{ width: `${Math.min(b.pct, 100)}%` }}
                  />
                </div>
                <p className="mt-1 font-mono text-[10px] text-sand tabular-nums">
                  {moneyShort(b.spent)} of {moneyShort(b.amount)} · {b.period}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function InquiriesPanel({
  latest,
}: {
  latest: Pick<Inquiry, "id" | "name" | "business" | "contact" | "status" | "created_at">[];
}) {
  return (
    <Panel
      title="Latest inquiries"
      hint="Straight from the website form"
      bodyClass="p-0"
      right={<ViewAll href="/admin/inquiries" />}
    >
      {latest.length === 0 ? (
        <div className="p-4">
          <EmptyState title="No inquiries yet" hint="Submissions from the walkthrough form appear here." />
        </div>
      ) : (
        <ul>
          {latest.map((i) => (
            <li key={i.id}>
              <Link
                href={hrefFor("inquiry", i.id) ?? "/admin/inquiries"}
                className="flex items-center gap-2.5 border-b border-cream/[0.05] px-4 py-3 transition-colors last:border-0 hover:bg-cream/[0.04]"
              >
                <Avatar name={i.name} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-cream">{i.name}</span>
                  <span className="block truncate text-[10.5px] text-sand">{i.business ?? i.contact}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[10.5px] text-sand">{relativeTime(i.created_at)}</span>
                  {i.status === "new" && (
                    <span className="mt-0.5 block font-mono text-[9.5px] uppercase tracking-[0.1em] text-terra-bright">
                      new
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function PipelinePanel({ pipeline }: { pipeline: PipelineData }) {
  const total = pipeline.openValue + pipeline.wonValue;
  return (
    <Panel title="Pipeline" hint="Where the value is sitting" bodyClass="p-0" right={<ViewAll href="/admin/crm" label="Open board" />}>
      {pipeline.stages.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-sand">No pipeline stages yet.</p>
      ) : (
        <ul>
          {pipeline.stages.map((s) => {
            const share = total > 0 ? (s.value / total) * 100 : 0;
            return (
              <li key={s.id} className="border-b border-cream/[0.05] px-4 py-2.5 last:border-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-[12px] text-cream-2">{s.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-sand tabular-nums">
                    {s.count} · {moneyShort(s.value)}
                  </span>
                </div>
                <div className="mt-1.5 h-1 w-full bg-cream/[0.06]">
                  <div
                    className={`h-full ${s.is_won ? "bg-ok-400/70" : s.is_lost ? "bg-sand/40" : "bg-terra"}`}
                    style={{ width: `${Math.max(share, s.value > 0 ? 4 : 0)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
