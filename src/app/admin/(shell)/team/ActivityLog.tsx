"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/admin/icons";
import { Avatar, Button, EmptyState, Field, Input, Panel, Select } from "@/components/admin/ui";
import { personName } from "@/components/admin/comments/mentions";
import { addDays, formatDate, formatDateTime, formatTime, toDateInput, todayISO } from "@/lib/admin/format";
import { ACTIVITY_PAGE, SYSTEM_ACTOR, type ActivityFilters } from "./activity";
import { hrefFor } from "@/lib/admin/links";
import type { ActivityEntry, TeamMember } from "@/lib/admin/types";

/**
 * Team → Activity: who changed what, newest first, grouped by Colombo day.
 * The filters live in the URL and run in the query (team/page.tsx), so an
 * older date range or a quiet person is found however long the log gets;
 * "Show more" asks for the next page the same way. Each line reads
 * "<actor> <summary>" — the summary is written by private.log_activity()
 * ("updated lead “Acme” · stage id") — and updates can be expanded to show
 * the column-by-column diff.
 */

const NOUN: Record<string, string> = {
  lead: "Leads",
  stage: "Pipeline stages",
  inquiry: "Inquiries",
  client: "Clients",
  invoice: "Invoices",
  quote: "Quotes",
  payment: "Payments",
  schedule: "Recurring invoices",
  entry: "Ledger",
  budget: "Budgets",
  approval: "Approvals",
  event: "Calendar",
  time_off: "Time off",
  todo: "To-dos",
  comment: "Comments",
  user: "Users",
};

const nounLabel = (type: string) => NOUN[type] ?? type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Every area the log knows, for the filter — not just the ones in the rows on screen. */
const AREAS = Object.keys(NOUN).sort((a, b) => nounLabel(a).localeCompare(nounLabel(b)));

export default function ActivityLog({
  entries,
  total,
  people,
  filters,
}: {
  /** The newest `filters.limit` rows matching the filters. */
  entries: ActivityEntry[];
  /** How many rows match the filters in all. */
  total: number;
  people: TeamMember[];
  filters: ActivityFilters;
}) {
  const router = useRouter();
  const [loading, startTransition] = useTransition();
  const [open, setOpen] = useState<number[]>([]);
  const { actor, entity, from, to, limit } = filters;

  const names = useMemo(() => new Map(people.map((p) => [p.id, personName(p)])), [people]);
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? "Former teammate") : "System");

  // Everyone on the team, plus whoever a link filtered to who has since left.
  const actors = useMemo(() => {
    const list = people.map((p) => ({ id: p.id, name: personName(p) })).sort((a, b) => a.name.localeCompare(b.name));
    if (actor && actor !== SYSTEM_ACTOR && !names.has(actor)) list.push({ id: actor, name: "Former teammate" });
    return [...list, { id: SYSTEM_ACTOR, name: "System" }];
  }, [people, names, actor]);
  const areas = entity && !AREAS.includes(entity) ? [...AREAS, entity] : AREAS;

  /** Swap one filter (or the page size) in the URL; the page re-runs the query. */
  const apply = (next: Partial<ActivityFilters>) => {
    const merged = { ...filters, ...next };
    const qs = new URLSearchParams({ tab: "activity" });
    if (merged.actor) qs.set("actor", merged.actor);
    if (merged.entity) qs.set("entity", merged.entity);
    if (merged.from) qs.set("from", merged.from);
    if (merged.to) qs.set("to", merged.to);
    // A new filter starts from the first page again.
    if (next.limit && merged.limit > ACTIVITY_PAGE) qs.set("show", String(merged.limit));
    startTransition(() => router.replace(`/admin/team?${qs}`, { scroll: false }));
  };

  const days = useMemo(() => {
    const groups: { day: string; rows: ActivityEntry[] }[] = [];
    for (const e of entries) {
      const day = toDateInput(new Date(e.created_at));
      const last = groups[groups.length - 1];
      if (last?.day === day) last.rows.push(e);
      else groups.push({ day, rows: [e] });
    }
    return groups;
  }, [entries]);

  const today = todayISO();
  const dayLabel = (day: string) =>
    day === today ? "Today" : day === addDays(today, -1) ? "Yesterday" : formatDate(`${day}T12:00:00+05:30`);

  const filtering = !!actor || !!entity || !!from || !!to;
  const clear = () => apply({ actor: null, entity: null, from: null, to: null });

  const toggle = (id: number) => setOpen((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] lg:items-end">
        <Field label="Person">
          <Select value={actor ?? ""} onChange={(e) => apply({ actor: e.target.value || null })}>
            <option value="">Everyone</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Area">
          <Select value={entity ?? ""} onChange={(e) => apply({ entity: e.target.value || null })}>
            <option value="">Everything</option>
            {areas.map((t) => (
              <option key={t} value={t}>
                {nounLabel(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From">
          <Input
            type="date"
            value={from ?? ""}
            max={to || undefined}
            onChange={(e) => apply({ from: e.target.value || null })}
          />
        </Field>
        <Field label="To">
          <Input type="date" value={to ?? ""} min={from || undefined} onChange={(e) => apply({ to: e.target.value || null })} />
        </Field>
        <Button onClick={clear} disabled={!filtering} className="min-h-9 sm:min-h-[38px]">
          Clear
        </Button>
      </div>

      <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-sand" aria-live="polite">
        {loading
          ? "Loading…"
          : `${total} ${total === 1 ? "change" : "changes"}${filtering ? " match" : ""}${
              entries.length < total ? ` · newest ${entries.length} shown` : ""
            }`}
      </p>

      {entries.length === 0 ? (
        <EmptyState
          title={filtering ? "Nothing matches these filters" : "No activity yet"}
          hint={
            filtering
              ? "Try another person, area or date range."
              : "Changes to leads, invoices, the ledger, the calendar and users are recorded here."
          }
        />
      ) : (
        <div className={`flex flex-col gap-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {days.map((group) => (
            <Panel
              key={group.day}
              title={dayLabel(group.day)}
              right={<span className="font-mono text-[10.5px] text-sand tabular-nums">{group.rows.length}</span>}
              bodyClass="p-0"
            >
              <ul className="divide-y divide-cream/[0.06]">
                {group.rows.map((e) => (
                  <Row
                    key={e.id}
                    entry={e}
                    actor={nameOf(e.actor_id)}
                    names={names}
                    expanded={open.includes(e.id)}
                    onToggle={() => toggle(e.id)}
                  />
                ))}
              </ul>
            </Panel>
          ))}
          {total > entries.length && entries.length >= limit && (
            <div className="flex justify-center">
              <Button
                onClick={() => apply({ limit: limit + ACTIVITY_PAGE })}
                disabled={loading}
                className="min-h-9 sm:min-h-0"
              >
                Show {Math.min(ACTIVITY_PAGE, total - entries.length)} more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  entry: e,
  actor,
  names,
  expanded,
  onToggle,
}: {
  entry: ActivityEntry;
  actor: string;
  names: Map<string, string>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const fields = e.changes ? Object.entries(e.changes) : [];
  const href = e.action === "deleted" ? null : hrefFor(e.entity_type, e.entity_id);

  return (
    <li className="flex min-w-0 gap-3 px-4 py-3">
      {e.actor_id ? (
        <Avatar name={actor} size={28} />
      ) : (
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cream/[0.06] text-sand ring-1 ring-cream/12">
          <Icon.bolt size={13} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="break-words text-[12.5px] leading-snug text-cream-2">
          <span className="font-medium text-cream">{actor}</span> {e.summary}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 font-mono text-[10px] uppercase tracking-[0.08em] text-sand/80">
          <span title={formatDateTime(e.created_at)}>{formatTime(e.created_at)}</span>
          <span>{nounLabel(e.entity_type)}</span>
          {fields.length > 0 && (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              className="inline-flex min-h-9 items-center gap-1 uppercase text-sand transition-colors hover:text-cream sm:min-h-0"
            >
              {expanded ? "Hide changes" : `${fields.length} ${fields.length === 1 ? "change" : "changes"}`}
              <Icon.chevron size={11} className={expanded ? "rotate-180" : ""} />
            </button>
          )}
          {href && (
            <Link
              href={href}
              className="inline-flex min-h-9 items-center gap-1 uppercase text-terra-bright transition-colors hover:text-cream sm:min-h-0"
            >
              Open
              <Icon.arrow size={11} />
            </Link>
          )}
        </div>

        {expanded && fields.length > 0 && (
          <div className="mt-2 overflow-x-auto scroll-thin">
            <table className="w-full min-w-[420px] border border-cream/[0.08] text-left text-[11.5px]">
              <thead>
                <tr className="border-b border-cream/[0.08] font-mono text-[9.5px] uppercase tracking-[0.16em] text-sand">
                  <th className="px-2.5 py-1.5 font-normal">Field</th>
                  <th className="px-2.5 py-1.5 font-normal">Before</th>
                  <th className="px-2.5 py-1.5 font-normal">After</th>
                </tr>
              </thead>
              <tbody>
                {fields.map(([field, diff]) => (
                  <tr key={field} className="border-b border-cream/[0.05] align-top last:border-0">
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-sand">{fieldLabel(field)}</td>
                    <td className="break-words px-2.5 py-1.5 text-sand/90 line-through decoration-sand/40">
                      {show(diff?.from, names)}
                    </td>
                    <td className="break-words px-2.5 py-1.5 text-cream">{show(diff?.to, names)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </li>
  );
}

const fieldLabel = (key: string) => key.replace(/_id$/, "").replace(/_/g, " ");

/** A diff value as a short readable string; ids of teammates become names. */
function show(value: unknown, names: Map<string, string>): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const person = names.get(value);
    if (person) return person;
    if (/^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))) return formatDateTime(value);
    return value.length > 160 ? `${value.slice(0, 160)}…` : value;
  }
  if (Array.isArray(value)) return value.length ? value.map((v) => show(v, names)).join(", ") : "—";
  const json = JSON.stringify(value);
  return json.length > 160 ? `${json.slice(0, 160)}…` : json;
}
