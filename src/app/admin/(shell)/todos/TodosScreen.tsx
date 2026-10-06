"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import CalendarView from "@/components/admin/calendar/CalendarView";
import { personName } from "@/components/admin/calendar/items";
import { Icon } from "@/components/admin/icons";
import { Tabs } from "@/components/admin/Tabs";
import { useAction } from "@/components/admin/useAction";
import { Button, EmptyState, Notice, fieldClass } from "@/components/admin/ui";
import { todayISO } from "@/lib/admin/format";
import { hrefFor } from "@/lib/admin/links";
import { canAccess } from "@/lib/admin/modules";
import type { CalendarItem, TeamMember } from "@/lib/admin/types";
import { moveTodo, setTodoStatus } from "@/app/admin/actions/todos";
import type { LeaveSpan, Todo, TodoLinks, TodoStatus } from "./model";
import QuickAdd from "./QuickAdd";
import TodoBoard, { type Move } from "./TodoBoard";
import TodoDrawer, { type DrawerTarget } from "./TodoDrawer";
import TodoList from "./TodoList";

type View = "list" | "board" | "calendar";
type Scope = "mine" | "by_me" | "all" | "person";

/** Assignees must be able to open To-dos. TeamMember carries no workspace; it's always the viewer's. */
const todoPeople = (team: TeamMember[]) => team.filter((m) => canAccess({ ...m, workspace: "live" }, "todos"));

/**
 * Drop the one-shot deep-link params so a reload doesn't reopen the drawer.
 * Next syncs useSearchParams with this replaceState (no server round trip),
 * which is what lets the same link open the drawer again — see `link` below.
 */
function clearParams(keys: string[]) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!keys.some((k) => url.searchParams.has(k))) return;
  for (const k of keys) url.searchParams.delete(k);
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export default function TodosScreen({
  todos,
  team,
  me,
  canAdmin,
  links,
  leave,
  calendar,
  openId,
  openNew,
  assignee,
  initialView,
  missing,
}: {
  todos: Todo[];
  team: TeamMember[];
  me: string;
  canAdmin: boolean;
  links: TodoLinks;
  leave: LeaveSpan[];
  calendar: { items: CalendarItem[]; month: string };
  openId: string | null;
  openNew: boolean;
  assignee: string | null;
  initialView: View;
  missing: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { run, pending, toast } = useAction();
  const today = todayISO();

  // Local mirror so a tick or a drop lands instantly; re-seeded whenever the
  // server sends a new list (the Board.tsx render-time pattern).
  const [list, setList] = useState(todos);
  const [seed, setSeed] = useState(todos);
  if (seed !== todos) {
    setSeed(todos);
    setList(todos);
  }

  const [view, setView] = useState<View>(initialView);
  const [scope, setScope] = useState<Scope>(assignee ? "person" : "mine");
  const [person, setPerson] = useState<string | null>(assignee);
  const [search, setSearch] = useState("");

  // The server props carry the (validated) deep link; the live URL says
  // whether it's still there. Closing drops it from the URL, so following the
  // same link again reads as a change even though the props come back equal.
  const link = {
    open: params.has("open") ? openId : null,
    new: params.get("new") === "1" && openNew,
    assignee: params.has("assignee") ? assignee : null,
  };
  const [drawer, setDrawer] = useState<DrawerTarget | null>(() =>
    link.open ? { id: link.open } : link.new ? { id: null } : null,
  );

  // A notification click, ⌘K or a Workload link while the page is already open.
  const [seen, setSeen] = useState(link);
  if (seen.open !== link.open || seen.new !== link.new || seen.assignee !== link.assignee) {
    setSeen(link);
    if (link.open && link.open !== seen.open) setDrawer({ id: link.open });
    else if (link.new && !seen.new) setDrawer({ id: null });
    if (link.assignee && link.assignee !== seen.assignee) {
      setPerson(link.assignee);
      setScope("person");
    }
  }

  const people = useMemo(() => todoPeople(team), [team]);
  const nameOf = useMemo(() => new Map(team.map((m) => [m.id, personName(m)])), [team]);
  const namesFor = useCallback((ids: string[]) => ids.map((id) => nameOf.get(id)).filter(Boolean) as string[], [nameOf]);

  const inScope = useCallback(
    (t: Todo, s: Scope) => {
      if (s === "mine") return t.assignees.includes(me) || (t.created_by === me && t.assignees.length === 0);
      if (s === "by_me") return t.created_by === me && t.assignees.some((a) => a !== me);
      if (s === "person") return !!person && t.assignees.includes(person);
      return true;
    },
    [me, person],
  );

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return list.filter(
      (t) =>
        inScope(t, scope) &&
        (!term || [t.title, t.notes, ...t.labels].some((v) => v && v.toLowerCase().includes(term))),
    );
  }, [list, scope, search, inScope]);

  const openCount = (s: Scope) => list.filter((t) => t.status !== "done" && inScope(t, s)).length;

  /* ── mutations ── */

  const toggle = (t: Todo) => {
    const status: TodoStatus = t.status === "done" ? "open" : "done";
    const stamp = status === "done" ? new Date().toISOString() : null;
    setList((prev) => prev.map((x) => (x.id === t.id ? { ...x, status, completed_at: stamp } : x)));
    run(() => setTodoStatus(t.id, status), { quiet: true });
  };

  const move = ({ id, status, positions }: Move) => {
    const at = new Map(positions.map((p) => [p.id, p.position]));
    const stamp = new Date().toISOString();
    setList((prev) =>
      prev.map((x) => {
        const position = at.get(x.id) ?? x.position;
        if (x.id !== id) return at.has(x.id) ? { ...x, position } : x;
        const completed_at = status === "done" ? (x.status === "done" ? x.completed_at : stamp) : null;
        return { ...x, status, position, completed_at };
      }),
    );
    run(() => moveTodo(id, status, positions), { quiet: true });
  };

  const closeDrawer = useCallback(() => {
    setDrawer(null);
    clearParams(["open", "new"]);
  }, []);

  const clearPerson = () => {
    setPerson(null);
    setScope("mine");
    clearParams(["assignee"]);
  };

  // Older done to-dos aren't in the list; the page loads one by ?open= on request.
  const openTodo = (id: string) => {
    if (list.some((t) => t.id === id)) setDrawer({ id });
    else router.push(hrefFor("todo", id) ?? "/admin/todos");
  };

  const drawerTodo = drawer?.id ? (list.find((t) => t.id === drawer.id) ?? null) : null;
  const personLabel = person ? (nameOf.get(person) ?? "Someone") : "";

  const scopes: { value: Scope; label: string; count?: number }[] = [
    { value: "mine", label: "My to-dos", count: openCount("mine") },
    { value: "by_me", label: "Assigned by me", count: openCount("by_me") },
    { value: "all", label: "Everyone", count: openCount("all") },
    ...(person ? [{ value: "person" as const, label: `${personLabel}'s`, count: openCount("person") }] : []),
  ];

  return (
    <>
      {missing && (
        <div className="mb-4">
          <Notice tone="warn" title="To-dos aren't set up yet">
            Run migration 0020 (todos) on the database — until then there&apos;s nothing to load or save.
          </Notice>
        </div>
      )}

      <QuickAdd people={people} run={run} pending={pending} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Tabs value={scope} onChange={setScope} options={scopes} />
          {scope === "person" && (
            <button
              type="button"
              onClick={clearPerson}
              aria-label={`Stop filtering to ${personLabel}`}
              className="flex h-9 w-9 items-center justify-center text-sand transition-colors hover:text-cream"
            >
              <Icon.close size={13} />
            </button>
          )}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Tabs
            value={view}
            onChange={setView}
            options={[
              { value: "list", label: "List", icon: <Icon.checklist size={13} /> },
              { value: "board", label: "Board", icon: <Icon.pipeline size={13} /> },
              { value: "calendar", label: "Calendar", icon: <Icon.calendar size={13} /> },
            ]}
          />
          {view !== "calendar" && (
            <div className="relative min-w-0 flex-1 sm:w-52 sm:flex-none">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sand">
                <Icon.search size={14} />
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search to-dos…"
                aria-label="Search to-dos"
                className={`${fieldClass} pl-9`}
              />
            </div>
          )}
          <Button variant="primary" className="min-h-9" onClick={() => setDrawer({ id: null })}>
            <Icon.plus size={13} /> New to-do
          </Button>
        </div>
      </div>

      {view === "calendar" ? (
        <CalendarView
          initialItems={calendar.items}
          initialMonth={calendar.month}
          people={team}
          only={["todo"]}
          me={me}
          onOpenTodo={openTodo}
          onCreateDay={(day) => setDrawer({ id: null, day })}
        />
      ) : shown.length === 0 ? (
        <EmptyState
          title={search ? "Nothing matches" : scope === "mine" ? "Nothing on your plate" : "No to-dos here"}
          hint={
            search
              ? "Try a different word — titles, notes and labels are searched."
              : "Add one above. Tag someone with @ and it shows on their calendar."
          }
        />
      ) : view === "board" ? (
        <TodoBoard todos={shown} all={list} today={today} namesFor={namesFor} onOpen={(id) => setDrawer({ id })} onMove={move} />
      ) : (
        <TodoList todos={shown} today={today} namesFor={namesFor} onToggle={toggle} onOpen={(id) => setDrawer({ id })} />
      )}

      <TodoDrawer
        target={drawer}
        todo={drawerTodo}
        people={people}
        team={team}
        me={me}
        canAdmin={canAdmin}
        links={links}
        leave={leave}
        run={run}
        pending={pending}
        onClose={closeDrawer}
      />
      {toast}
    </>
  );
}
