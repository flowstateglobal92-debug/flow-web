"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { useAction } from "../useAction";
import { Avatar, AvatarStack, Button, Panel } from "../ui";
import type { CalendarItem, CalendarItemKind, TeamMember } from "@/lib/admin/types";
import { addDays, formatTime, todayISO } from "@/lib/admin/format";
import TimeOffDetail from "../timeoff/TimeOffDetail";
import EventModal, { type EventTarget } from "./EventModal";
import {
  FILTER_LABEL,
  HATCH,
  chipTone,
  dayLabel,
  dayNumber,
  filterOf,
  gridRange,
  isUnscheduled,
  itemDays,
  lastOfMonth,
  monthGrid,
  monthLabel,
  personName,
  shiftMonth,
  sortItems,
  weekOf,
  weekdayShort,
  type CalendarFilter,
} from "./items";

/**
 * The shared calendar — Month / Week / Agenda.
 *
 * CONTRACT (the dashboard widget, /admin/calendar, the To-dos calendar view
 * and Workload render it — keep the export and these props):
 *   <CalendarView
 *     initialItems      CalendarItem[] for the initial month's grid range
 *     initialMonth      "YYYY-MM"
 *     people            TeamMember[] (avatars, attendee picker)
 *     variant?          "full" | "compact"   compact = dashboard widget
 *     only?             CalendarItemKind[]    e.g. ["todo"] on the To-dos page
 *     canCreate?        boolean               show "+ Event" / day add
 *   Optional extras:
 *     me?               viewer id — enables the Everyone / Mine filter
 *     onOpenTodo?(id)   open a to-do in place instead of following its link
 *     onCreateDay?(day) day "+" makes something other than an event (To-dos)
 *     openEventId? openNew? openTimeOffId?   deep links (?event= ?new=1 ?timeoff=)
 *   />
 *
 * Paging months fetches /admin/calendar/feed (abortable) instead of
 * re-running the page. Below `sm` the grid is swapped for the agenda by CSS
 * alone, so there's no viewport check to hydrate wrong.
 */

type View = "month" | "week" | "agenda";
type Modal = { type: "event"; target: EventTarget } | { type: "time_off"; id: string } | null;

const ALL_KINDS: CalendarItemKind[] = ["event", "todo", "time_off", "invoice_due", "quote_expiry", "recurring_run"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const navBtn =
  "flex h-9 w-9 items-center justify-center border border-cream/12 text-cream-2 transition-colors hover:bg-cream/[0.06] sm:h-8 sm:w-8";
const pill = "inline-flex min-h-9 items-center gap-1.5 border px-2.5 py-1 text-[11.5px] font-medium transition-colors sm:min-h-8";
const pillOn = "border-terra/50 bg-terra/15 text-terra-bright";
const pillOff = "border-cream/12 bg-cream/[0.03] text-cream-2 hover:border-cream/30 hover:text-cream";

const startCursor = (month: string, today: string) => (today.slice(0, 7) === month ? today : `${month}-01`);

export default function CalendarView({
  initialItems,
  initialMonth,
  people,
  variant = "full",
  only,
  canCreate = true,
  me,
  onOpenTodo,
  onCreateDay,
  openEventId = null,
  openNew = false,
  openTimeOffId = null,
}: {
  initialItems: CalendarItem[];
  initialMonth: string;
  people: TeamMember[];
  variant?: "full" | "compact";
  only?: CalendarItem["kind"][];
  canCreate?: boolean;
  me?: string;
  onOpenTodo?: (id: string) => void;
  onCreateDay?: (day: string) => void;
  openEventId?: string | null;
  openNew?: boolean;
  openTimeOffId?: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { run, pending, toast } = useAction();
  const today = todayISO();
  const compact = variant === "compact";

  // The props carry the (validated) deep link; the live URL says whether it's
  // still there. closeModal drops it from the URL, so following the same link
  // again reads as a change even though the props come back equal.
  const link = {
    event: params.has("event") ? openEventId : null,
    timeOff: params.has("timeoff") ? openTimeOffId : null,
    new: params.get("new") === "1" && openNew,
  };

  const [cursor, setCursor] = useState(() => startCursor(initialMonth, today));
  const [view, setView] = useState<View>("month");
  const [items, setItems] = useState(initialItems);
  const [stale, setStale] = useState(false);
  const [failed, setFailed] = useState(false);
  const [who, setWho] = useState<"everyone" | "mine">("everyone");
  const [hidden, setHidden] = useState<CalendarFilter[]>([]);

  const deepLink = (): Modal =>
    link.event
      ? { type: "event", target: { id: link.event } }
      : link.timeOff
        ? { type: "time_off", id: link.timeOff }
        : link.new && canCreate && !onCreateDay
          ? { type: "event", target: { id: null, day: today } }
          : null;
  const [modal, setModal] = useState<Modal>(deepLink);

  const month = cursor.slice(0, 7);

  // Re-sync when the server sends fresh items (router.refresh after a save)
  // or lands on another month (a deep link) — the Board.tsx render-time pattern.
  const [seed, setSeed] = useState({ items: initialItems, month: initialMonth });
  if (seed.items !== initialItems || seed.month !== initialMonth) {
    const moved = seed.month !== initialMonth;
    setSeed({ items: initialItems, month: initialMonth });
    if (moved) setCursor(startCursor(initialMonth, today));
    if (moved || month === initialMonth) {
      setItems(initialItems);
      setStale(false);
    } else {
      // Fresh data is for a month we're not looking at — refetch ours.
      setStale(true);
    }
  }

  const linkKey = `${link.event ?? ""}|${link.timeOff ?? ""}|${link.new ? 1 : 0}`;
  const [linkSeed, setLinkSeed] = useState(linkKey);
  if (linkSeed !== linkKey) {
    setLinkSeed(linkKey);
    const next = deepLink();
    if (next) setModal(next);
  }

  const onlyKey = only?.join(",") ?? "";

  // The month's items come from the feed; aborting on cleanup means paging
  // quickly never lets an older response land last.
  useEffect(() => {
    if (!stale) return;
    const ctrl = new AbortController();
    const { from, to } = gridRange(month);
    const qs = new URLSearchParams({ from, to });
    if (onlyKey) qs.set("only", onlyKey);
    fetch(`/admin/calendar/feed?${qs}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: unknown) => {
        setItems(Array.isArray(data) ? (data as CalendarItem[]) : []);
        setFailed(false);
        setStale(false);
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setItems([]);
        setFailed(true);
        setStale(false);
      });
    return () => ctrl.abort();
  }, [stale, month, onlyKey]);

  const go = (day: string) => {
    if (day.slice(0, 7) !== month) setStale(true);
    setCursor(day);
  };
  const step = (by: number) => {
    if (view === "week") go(addDays(cursor, 7 * by));
    else go(startCursor(shiftMonth(month, by), today));
  };

  const closeModal = useCallback(() => {
    setModal(null);
    // Drop ?event= / ?timeoff= / ?new= so a reload doesn't reopen it. Next
    // syncs useSearchParams with this (no server round trip), which re-arms the link.
    if (typeof window !== "undefined" && /[?&](event|timeoff|new)=/.test(window.location.search)) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  /* ── what's showing ── */

  // Keyed on the joined string so an inline `only={["todo"]}` doesn't bust every memo.
  const kinds = useMemo(() => (onlyKey ? (onlyKey.split(",") as CalendarItemKind[]) : ALL_KINDS), [onlyKey]);
  const filters = useMemo(() => [...new Set(kinds.map(filterOf))], [kinds]);
  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, personName(p)])), [people]);
  const namesFor = useCallback(
    (ids: string[]) => ids.map((id) => nameOf.get(id)).filter(Boolean) as string[],
    [nameOf],
  );

  const visible = useMemo(
    () =>
      items.filter(
        (i) =>
          kinds.includes(i.kind) &&
          !hidden.includes(filterOf(i.kind)) &&
          (who === "everyone" || !me || i.created_by === me || i.people.includes(me)),
      ),
    [items, kinds, hidden, who, me],
  );

  const { byDay, outByDay, unscheduled } = useMemo(() => {
    const byDay = new Map<string, CalendarItem[]>();
    const outByDay = new Map<string, CalendarItem[]>();
    const unscheduled: CalendarItem[] = [];
    for (const item of visible) {
      if (isUnscheduled(item)) {
        unscheduled.push(item);
        continue;
      }
      const target = item.kind === "time_off" ? outByDay : byDay;
      for (const d of itemDays(item)) {
        const list = target.get(d);
        if (list) list.push(item);
        else target.set(d, [item]);
      }
    }
    for (const list of byDay.values()) list.sort(sortItems);
    return { byDay, outByDay, unscheduled };
  }, [visible]);

  const open = (item: CalendarItem) => {
    if (item.kind === "event") return setModal({ type: "event", target: { id: item.id } });
    if (item.kind === "time_off") return setModal({ type: "time_off", id: item.id });
    if (item.kind === "todo" && onOpenTodo) return onOpenTodo(item.id);
    if (item.href) router.push(item.href);
  };

  const addOn = canCreate
    ? (day: string) => (onCreateDay ? onCreateDay(day) : setModal({ type: "event", target: { id: null, day } }))
    : null;

  const grid = useMemo(() => monthGrid(month), [month]);
  const week = useMemo(() => weekOf(cursor), [cursor]);
  const title = view === "week" && !compact ? weekTitle(week) : monthLabel(month);
  const mine = who === "mine";

  /* ── render ── */

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cream/[0.07] px-3 py-2.5 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="truncate font-display text-[14px] font-medium text-cream sm:text-[15px]">{title}</h2>
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.14em] text-sand transition-opacity ${stale ? "opacity-100" : "opacity-0"}`}
          aria-live="polite"
        >
          Loading
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button onClick={() => go(today)} className="min-h-9 sm:min-h-0">
          Today
        </Button>
        <button type="button" onClick={() => step(-1)} aria-label={view === "week" ? "Previous week" : "Previous month"} className={navBtn}>
          <Icon.chevronLeft size={14} />
        </button>
        <button type="button" onClick={() => step(1)} aria-label={view === "week" ? "Next week" : "Next month"} className={navBtn}>
          <Icon.chevronRight size={14} />
        </button>
        {!compact && (
          <div role="tablist" aria-label="View" className="ml-1 hidden items-center gap-1 sm:flex">
            {(["month", "week", "agenda"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`${pill} capitalize ${view === v ? pillOn : pillOff}`}
              >
                {v}
              </button>
            ))}
          </div>
        )}
        {compact ? (
          <Link
            href="/admin/calendar"
            className="ml-1 inline-flex min-h-9 items-center gap-1 px-1.5 text-[11.5px] text-sand transition-colors hover:text-cream sm:min-h-0"
          >
            Open <Icon.arrow size={12} />
          </Link>
        ) : (
          addOn &&
          !onCreateDay && (
            <Button variant="primary" className="min-h-9 sm:min-h-0" onClick={() => addOn(view === "week" ? cursor : today)}>
              <Icon.plus size={13} /> Event
            </Button>
          )
        )}
      </div>
    </div>
  );

  const toolbar = !compact && (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-cream/[0.07] px-3 py-2 sm:px-4">
      {me && (
        <>
          {(["everyone", "mine"] as const).map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={who === w}
              onClick={() => setWho(w)}
              className={`${pill} ${who === w ? pillOn : pillOff}`}
            >
              {w === "everyone" ? "Everyone" : "Mine"}
            </button>
          ))}
          {filters.length > 1 && <span className="mx-1 h-4 w-px bg-cream/10" aria-hidden />}
        </>
      )}
      {filters.length > 1 &&
        filters.map((f) => {
          const on = !hidden.includes(f);
          return (
            <button
              key={f}
              type="button"
              aria-pressed={on}
              onClick={() => setHidden((h) => (on ? [...h, f] : h.filter((x) => x !== f)))}
              className={`${pill} ${on ? "border-cream/25 bg-cream/[0.07] text-cream" : "border-cream/10 text-sand/70 line-through decoration-sand/40"}`}
            >
              {FILTER_LABEL[f]}
            </button>
          );
        })}
    </div>
  );

  const unscheduledTray = unscheduled.length > 0 && !compact && (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-cream/[0.07] px-3 py-2 sm:px-4">
      <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.14em] text-sand">Unscheduled</span>
      {unscheduled.slice(0, 12).map((item) => (
        <Chip key={item.key} item={item} names={namesFor(item.people)} onOpen={open} wide />
      ))}
      {unscheduled.length > 12 && <span className="font-mono text-[10.5px] text-sand">+{unscheduled.length - 12}</span>}
    </div>
  );

  return (
    <>
      <Panel bodyClass="p-0">
        {header}
        {toolbar}
        {unscheduledTray}

        {failed && (
          <div className="flex items-center justify-between gap-3 border-b border-rose-400/20 bg-rose-500/[0.06] px-4 py-2 text-[12px] text-rose-200">
            <span>Couldn&apos;t load this month.</span>
            <button type="button" onClick={() => setStale(true)} className="min-h-9 underline-offset-2 hover:underline">
              Try again
            </button>
          </div>
        )}

        {/* Grid views from sm up; the agenda below sm (and when picked). */}
        <div className={view === "agenda" && !compact ? "hidden" : "hidden sm:block"}>
          {view === "week" && !compact ? (
            <WeekGrid
              days={week}
              today={today}
              byDay={byDay}
              outByDay={outByDay}
              namesFor={namesFor}
              onOpen={open}
              onAdd={addOn}
            />
          ) : (
            <MonthGrid
              days={grid}
              month={month}
              today={today}
              byDay={byDay}
              outByDay={outByDay}
              namesFor={namesFor}
              onOpen={open}
              onAdd={addOn}
              onMore={(day) => {
                if (compact) return router.push("/admin/calendar");
                setCursor(day);
                setView("week");
              }}
              compact={compact}
            />
          )}
        </div>
        <div className={view === "agenda" && !compact ? "block" : "sm:hidden"}>
          <Agenda
            month={month}
            today={today}
            byDay={byDay}
            outByDay={outByDay}
            namesFor={namesFor}
            onOpen={open}
            onAdd={addOn}
            compact={compact}
            empty={mine ? "Nothing of yours this month." : "Nothing scheduled this month."}
          />
        </div>

        {!compact && kinds.includes("time_off") && outByDay.size > 0 && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-cream/[0.07] px-4 py-2 font-mono text-[10px] text-sand">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-4 border border-cream/15" style={HATCH} /> Out · approved
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-4 border border-dashed border-amber-300/50" /> Out · pending
            </span>
          </p>
        )}
      </Panel>

      <EventModal
        target={modal?.type === "event" ? modal.target : null}
        onClose={closeModal}
        people={people}
        me={me}
        run={run}
        pending={pending}
      />
      <TimeOffDetail id={modal?.type === "time_off" ? modal.id : null} onClose={closeModal} run={run} pending={pending} />
      {toast}
    </>
  );
}

function weekTitle(days: string[]) {
  const a = days[0];
  const b = days[6];
  return a.slice(0, 7) === b.slice(0, 7)
    ? `${dayNumber(a)} – ${dayNumber(b)} ${monthLabel(b.slice(0, 7))}`
    : `${dayLabel(a)} – ${dayLabel(b)}`;
}

/* ─────────────────────────────── pieces ─────────────────────────────── */

type Shared = {
  today: string;
  byDay: Map<string, CalendarItem[]>;
  outByDay: Map<string, CalendarItem[]>;
  namesFor: (ids: string[]) => string[];
  onOpen: (item: CalendarItem) => void;
  onAdd: ((day: string) => void) | null;
};

/** One item on the grid: time, title, and the people on it. */
function Chip({
  item,
  names,
  onOpen,
  showTime = true,
  wide = false,
}: {
  item: CalendarItem;
  names: string[];
  onOpen: (item: CalendarItem) => void;
  showTime?: boolean;
  wide?: boolean;
}) {
  const time = showTime && !item.all_day ? formatTime(item.starts_at) : null;
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      title={item.title}
      className={`flex min-w-0 items-center gap-1 border px-1.5 py-0.5 text-left text-[10.5px] leading-snug transition-colors hover:brightness-125 ${
        wide ? "min-h-9 max-w-[240px] px-2 sm:min-h-0 sm:px-1.5" : "w-full"
      } ${chipTone(item)} ${item.done ? "opacity-45 line-through" : ""}`}
    >
      {item.kind === "todo" && (
        <span className={`h-2 w-2 shrink-0 border ${item.done ? "border-current bg-current" : "border-current"}`} aria-hidden />
      )}
      {time && <span className="shrink-0 font-mono text-[9.5px] opacity-80">{time}</span>}
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {names.length > 0 && <AvatarStack names={names} max={2} size={14} />}
    </button>
  );
}

/** Who's out on a day: small avatars, solid for approved, dashed for pending. */
function OutMarks({
  list,
  namesFor,
  onOpen,
  max = 3,
}: {
  list: CalendarItem[];
  namesFor: (ids: string[]) => string[];
  onOpen: (item: CalendarItem) => void;
  max?: number;
}) {
  return (
    <span className="flex min-w-0 items-center gap-0.5">
      {list.slice(0, max).map((t) => {
        const name = namesFor(t.people)[0] ?? t.title.split(" · ")[0];
        const pendingLeave = t.status === "pending";
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onOpen(t)}
            title={`${t.title}${pendingLeave ? " · pending" : ""}`}
            aria-label={`${t.title}${pendingLeave ? ", pending" : ""}`}
            className={`rounded-full ${pendingLeave ? "outline-1 outline-dashed outline-amber-300/70" : ""}`}
          >
            <Avatar name={name} size={16} />
          </button>
        );
      })}
      {list.length > max && <span className="ml-0.5 font-mono text-[9.5px] text-sand">+{list.length - max}</span>}
    </span>
  );
}

function MonthGrid({
  days,
  month,
  today,
  byDay,
  outByDay,
  namesFor,
  onOpen,
  onAdd,
  onMore,
  compact,
}: Shared & { days: string[]; month: string; onMore: (day: string) => void; compact: boolean }) {
  const cap = compact ? 2 : 3;
  return (
    <div className="p-2 sm:p-3">
      <div className="grid grid-cols-7 gap-px border border-cream/[0.06] bg-cream/[0.06]">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-ink px-2 py-1.5 text-center text-[10px] uppercase tracking-[0.16em] text-sand">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const list = byDay.get(day) ?? [];
          const out = outByDay.get(day) ?? [];
          const isToday = day === today;
          return (
            <div
              key={day}
              className={`relative min-w-0 bg-ink px-1.5 pb-1.5 pt-1 ${compact ? "min-h-[78px]" : "min-h-[104px]"} ${
                day.slice(0, 7) === month ? "" : "opacity-40"
              } ${isToday ? "ring-1 ring-inset ring-terra/50" : ""}`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className={`font-mono text-[10.5px] tabular-nums ${isToday ? "text-terra-bright" : "text-sand"}`}>
                  {dayNumber(day)}
                </span>
                {onAdd && (
                  <button
                    type="button"
                    onClick={() => onAdd(day)}
                    aria-label={`Add on ${dayLabel(day)}`}
                    className="-mr-1 flex h-6 w-6 items-center justify-center text-sand/80 transition-colors hover:text-terra-bright focus-visible:text-terra-bright"
                  >
                    <Icon.plus size={12} />
                  </button>
                )}
              </div>
              {/* The "Who's out" lane — same height in every cell so each week reads as a row. */}
              <div className="mt-0.5 flex h-[18px] items-center">
                {out.length > 0 && <OutMarks list={out} namesFor={namesFor} onOpen={onOpen} max={compact ? 2 : 3} />}
              </div>
              <div className="mt-1 space-y-1">
                {list.slice(0, cap).map((item) => (
                  <Chip key={item.key} item={item} names={namesFor(item.people)} onOpen={onOpen} />
                ))}
                {list.length > cap && (
                  <button
                    type="button"
                    onClick={() => onMore(day)}
                    className="block w-full text-left text-[10px] text-sand hover:text-cream"
                  >
                    +{list.length - cap} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({ days, today, byDay, outByDay, namesFor, onOpen, onAdd }: Shared & { days: string[] }) {
  const label = "bg-ink px-2 py-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-sand";
  return (
    <div className="overflow-x-auto p-2 scroll-thin sm:p-3" data-lenis-prevent>
      <div className="grid min-w-[760px] grid-cols-[64px_repeat(7,minmax(0,1fr))] gap-px border border-cream/[0.06] bg-cream/[0.06]">
        <div className="bg-ink" />
        {days.map((day) => (
          <div key={day} className={`flex items-center justify-between gap-1 bg-ink px-2 py-1.5 ${day === today ? "text-terra-bright" : "text-cream-2"}`}>
            <span className="min-w-0 truncate text-[11px]">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-sand">{weekdayShort(day)}</span>{" "}
              <span className="font-mono tabular-nums">{dayNumber(day)}</span>
            </span>
            {onAdd && (
              <button
                type="button"
                onClick={() => onAdd(day)}
                aria-label={`Add on ${dayLabel(day)}`}
                className="flex h-6 w-6 shrink-0 items-center justify-center text-sand/80 transition-colors hover:text-terra-bright focus-visible:text-terra-bright"
              >
                <Icon.plus size={12} />
              </button>
            )}
          </div>
        ))}

        <div className={label}>Out</div>
        {days.map((day) => (
          <div key={day} className="min-w-0 space-y-1 bg-ink p-1.5">
            {(outByDay.get(day) ?? []).map((t) => {
              const pendingLeave = t.status === "pending";
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => onOpen(t)}
                  title={`${t.title}${pendingLeave ? " · pending" : ""}`}
                  className={`flex w-full min-w-0 items-center gap-1.5 border px-1.5 py-0.5 text-left text-[10.5px] text-cream-2 ${
                    pendingLeave ? "border-dashed border-amber-300/50" : "border-cream/15"
                  }`}
                  style={pendingLeave ? undefined : HATCH}
                >
                  <Avatar name={namesFor(t.people)[0] ?? "?"} size={14} />
                  <span className="min-w-0 flex-1 truncate">{t.title.split(" · ")[0]}</span>
                </button>
              );
            })}
          </div>
        ))}

        <div className={label}>All day</div>
        {days.map((day) => (
          <div key={day} className="min-w-0 space-y-1 bg-ink p-1.5">
            {(byDay.get(day) ?? [])
              .filter((i) => i.all_day)
              .map((item) => (
                <Chip key={item.key} item={item} names={namesFor(item.people)} onOpen={onOpen} />
              ))}
          </div>
        ))}

        <div className={label}>Timed</div>
        {days.map((day) => (
          <div key={day} className="min-h-[220px] min-w-0 space-y-1 bg-ink p-1.5">
            {(byDay.get(day) ?? [])
              .filter((i) => !i.all_day)
              .map((item) => (
                <Chip key={item.key} item={item} names={namesFor(item.people)} onOpen={onOpen} />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Agenda({
  month,
  today,
  byDay,
  outByDay,
  namesFor,
  onOpen,
  onAdd,
  compact,
  empty,
}: Shared & { month: string; compact: boolean; empty: string }) {
  // This month from today onwards (or the whole month if it's another one).
  const first = today.slice(0, 7) === month ? today : `${month}-01`;
  const last = lastOfMonth(month);
  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    if (byDay.has(d) || outByDay.has(d) || d === today) days.push(d);
  }
  const shown = compact ? days.slice(0, 6) : days;
  const anything = days.some((d) => byDay.has(d) || outByDay.has(d));

  if (!anything) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-[12px] text-sand">{empty}</p>
        {onAdd && (
          <button
            type="button"
            onClick={() => onAdd(first)}
            className="mt-3 inline-flex min-h-9 items-center gap-1.5 border border-cream/12 px-3 text-[12px] text-cream-2 hover:border-cream/30 hover:text-cream"
          >
            <Icon.plus size={12} /> Add something
          </button>
        )}
      </div>
    );
  }

  return (
    <ul>
      {shown.map((day) => {
        const list = byDay.get(day) ?? [];
        const out = outByDay.get(day) ?? [];
        return (
          <li key={day} className="border-b border-cream/[0.06] px-3 py-2.5 last:border-0 sm:px-4">
            <div className="flex items-center justify-between gap-2">
              <p className={`font-mono text-[10.5px] uppercase tracking-[0.12em] ${day === today ? "text-terra-bright" : "text-sand"}`}>
                {day === today ? `Today · ${dayLabel(day)}` : dayLabel(day)}
              </p>
              {onAdd && (
                <button
                  type="button"
                  onClick={() => onAdd(day)}
                  aria-label={`Add on ${dayLabel(day)}`}
                  className="flex h-9 w-9 items-center justify-center text-sand transition-colors hover:text-terra-bright"
                >
                  <Icon.plus size={14} />
                </button>
              )}
            </div>
            {out.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {out.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => onOpen(t)}
                    className={`inline-flex min-h-8 max-w-full items-center gap-1.5 border px-2 text-[11px] text-cream-2 ${
                      t.status === "pending" ? "border-dashed border-amber-300/50" : "border-cream/15"
                    }`}
                    style={t.status === "pending" ? undefined : HATCH}
                  >
                    <Avatar name={namesFor(t.people)[0] ?? "?"} size={16} />
                    <span className="truncate">
                      {t.title}
                      {t.status === "pending" ? " · pending" : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {list.length === 0 && out.length === 0 ? (
              <p className="mt-1 text-[11.5px] text-sand/70">Nothing yet.</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {list.map((item) => {
                  const names = namesFor(item.people);
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        onClick={() => onOpen(item)}
                        className={`flex min-h-10 w-full min-w-0 items-center gap-2.5 border px-2.5 py-1.5 text-left ${chipTone(item)} ${
                          item.done ? "opacity-50" : ""
                        }`}
                      >
                        <span className="w-11 shrink-0 font-mono text-[10.5px] tabular-nums opacity-80">
                          {item.all_day ? "all day" : formatTime(item.starts_at)}
                        </span>
                        <span className={`min-w-0 flex-1 truncate text-[12.5px] ${item.done ? "line-through" : ""}`}>{item.title}</span>
                        {names.length > 0 && <AvatarStack names={names} max={3} size={18} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
