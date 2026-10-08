import Link from "next/link";
import type { ReactNode } from "react";
import { moneyShort, num } from "@/lib/admin/format";
import { Avatar, Badge } from "@/components/admin/ui";
import { HATCH, dayLabel, weekdayIndex, weekdayShort } from "@/components/admin/calendar/items";

/** One row of team_workload() (0023). Numbers may arrive as strings from numeric columns. */
export type WorkloadPerson = {
  user_id: string;
  full_name: string | null;
  title: string | null;
  open_todos: number;
  overdue_todos: number;
  due_this_week: number;
  meeting_hours: number;
  leads_owned: number;
  pipeline_value: number;
  clients_managed: number;
  /** Balance left on their issued LKR invoices — Rs, like pipeline_value. */
  outstanding_owned: number;
  leave_days: number;
  days: { date: string; todos_due: number; meeting_hours: number; leave: null | "full" | "am" | "pm" }[];
};

/** team_workload() as a whole: the rows, plus the team's to-dos counted once each. */
export type WorkloadData = {
  team: { open_todos: number; overdue_todos: number; due_this_week: number };
  people: WorkloadPerson[];
};

export type Load = { level: "away" | "light" | "balanced" | "heavy"; perDay: number };

/**
 * The load heuristic, spelled out on the page: (due this week + overdue +
 * meeting hours ÷ 2) per working day available. Weekends don't count as
 * capacity; leave removes days, a half day removes half.
 */
export function loadOf(p: WorkloadPerson): Load {
  const workdays = (p.days ?? []).filter((d) => weekdayIndex(d.date) < 5);
  const available = workdays.reduce((a, d) => a + (d.leave === "full" ? 0 : d.leave ? 0.5 : 1), 0);
  if (workdays.length > 0 && available === 0) return { level: "away", perDay: 0 };
  const demand = num(p.due_this_week) + num(p.overdue_todos) + num(p.meeting_hours) / 2;
  const perDay = demand / Math.max(available || 5, 0.5);
  return { level: perDay < 1 ? "light" : perDay <= 2.5 ? "balanced" : "heavy", perDay };
}

const LOAD_TONE = { away: "muted", light: "muted", balanced: "cream", heavy: "danger" } as const;
const LOAD_LABEL = { away: "Away", light: "Light", balanced: "Balanced", heavy: "Heavy" } as const;

function Metric({ label, value, tone = "" }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate font-mono text-[9.5px] uppercase tracking-[0.14em] text-sand">{label}</dt>
      <dd className={`mt-0.5 truncate font-mono text-[12.5px] tabular-nums ${tone || "text-cream-2"}`}>{value}</dd>
    </div>
  );
}

/**
 * Mon–Sun: hatched for leave (half-hatched for a half day), quiet bars for
 * to-dos and meetings, and the to-do count printed under each day so touch
 * screens get the number without a hover. Each day reads out its full line.
 */
function Strip({ days, today }: { days: WorkloadPerson["days"]; today: string }) {
  return (
    <div className="grid min-w-0 grid-cols-7 gap-1" role="group" aria-label="Availability this week">
      {(days ?? []).slice(0, 7).map((d) => {
        const todos = num(d.todos_due);
        const hours = num(d.meeting_hours);
        const tip = [
          dayLabel(d.date),
          `${todos} due`,
          `${hours}h meetings`,
          d.leave ? (d.leave === "full" ? "on leave" : `on leave (${d.leave.toUpperCase()})`) : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <div key={d.date} title={tip} role="img" aria-label={tip} className="min-w-0">
            <p className={`text-center font-mono text-[9.5px] uppercase ${d.date === today ? "text-terra-bright" : "text-sand"}`}>
              {weekdayShort(d.date).slice(0, 2)}
            </p>
            <div
              className={`relative mt-1 flex h-10 items-end justify-center gap-[3px] overflow-hidden border px-1 pb-1 ${
                d.date === today ? "border-terra/40" : "border-cream/[0.08]"
              } ${weekdayIndex(d.date) >= 5 ? "bg-cream/[0.015]" : "bg-ink/40"}`}
            >
              {d.leave && (
                <span
                  aria-hidden
                  className={`absolute inset-x-0 ${d.leave === "full" ? "inset-y-0" : d.leave === "am" ? "top-0 h-1/2" : "bottom-0 h-1/2"}`}
                  style={HATCH}
                />
              )}
              <span className="relative w-1.5 bg-terra/80" style={{ height: `${Math.min(todos, 5) * 20}%` }} />
              <span className="relative w-1.5 bg-cream/40" style={{ height: `${Math.min(hours, 8) * 12.5}%` }} />
            </div>
            <p className={`mt-0.5 text-center font-mono text-[9.5px] tabular-nums ${todos ? "text-cream-2" : "text-sand"}`}>
              {todos}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export default function WorkloadRow({ person: p, today, href }: { person: WorkloadPerson; today: string; href: string | null }) {
  const name = p.full_name || "Teammate";
  const load = loadOf(p);
  const overdue = num(p.overdue_todos);

  const body = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={name} size={34} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-cream">{name}</p>
          <p className="truncate text-[11px] text-sand">{p.title || "Team member"}</p>
        </div>
        <div className="shrink-0 text-right" title="A heuristic — see the note below the list.">
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-sand">Load · heuristic</p>
          <Badge tone={LOAD_TONE[load.level]} className="mt-1">
            {LOAD_LABEL[load.level]}
          </Badge>
        </div>
      </div>

      <Strip days={p.days} today={today} />

      <dl className="grid min-w-0 grid-cols-3 gap-x-3 gap-y-2.5">
        <Metric
          label="Open"
          value={
            <>
              {num(p.open_todos)}
              {overdue > 0 && <span className="text-bad-300"> · {overdue} late</span>}
            </>
          }
        />
        <Metric label="Due this wk" value={num(p.due_this_week)} />
        <Metric label="Meetings" value={`${Math.round(num(p.meeting_hours) * 10) / 10}h`} />
        <Metric label="Leads" value={`${num(p.leads_owned)} · ${moneyShort(num(p.pipeline_value))}`} />
        <Metric label="Clients" value={num(p.clients_managed)} />
        <Metric
          label="Outstanding"
          value={moneyShort(num(p.outstanding_owned))}
          tone={num(p.outstanding_owned) > 0 ? "text-warn-100" : ""}
        />
      </dl>
    </>
  );

  const layout =
    "grid grid-cols-1 items-center gap-4 px-4 py-4 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)_minmax(0,320px)] lg:gap-6";

  return (
    <li className="border-b border-cream/[0.05] last:border-0">
      {href ? (
        <Link href={href} className={`${layout} transition-colors hover:bg-cream/[0.03]`}>
          {body}
        </Link>
      ) : (
        <div className={layout}>{body}</div>
      )}
    </li>
  );
}
