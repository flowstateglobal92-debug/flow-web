"use client";

import { useState } from "react";
import { Icon } from "@/components/admin/icons";
import { AvatarStack } from "@/components/admin/ui";
import { GROUPS, GROUP_LABEL, byDue, groupOf, type Group, type Todo } from "./model";
import TodoMeta from "./TodoMeta";

const DONE_PREVIEW = 8;

/** Grouped by when it's due: Overdue · Today · This week · Later · No date · Done. */
export default function TodoList({
  todos,
  today,
  namesFor,
  onToggle,
  onOpen,
}: {
  todos: Todo[];
  today: string;
  namesFor: (ids: string[]) => string[];
  onToggle: (todo: Todo) => void;
  onOpen: (id: string) => void;
}) {
  const [allDone, setAllDone] = useState(false);
  const now = new Date().getTime();

  const groups = new Map<Group, Todo[]>(GROUPS.map((g) => [g, []]));
  for (const t of todos) groups.get(groupOf(t, today, now))!.push(t);
  for (const [g, list] of groups) {
    if (g === "done") list.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
    else list.sort(byDue);
  }

  return (
    <div className="space-y-4">
      {GROUPS.map((g) => {
        const list = groups.get(g)!;
        if (list.length === 0) return null;
        const shown = g === "done" && !allDone ? list.slice(0, DONE_PREVIEW) : list;
        return (
          <section key={g} className="border border-cream/[0.08] bg-cream/[0.015]">
            <header className="flex items-center justify-between gap-2 border-b border-cream/[0.06] px-3 py-2">
              <h3
                className={`font-mono text-[10.5px] uppercase tracking-[0.16em] ${
                  g === "overdue" ? "text-bad-300" : g === "today" ? "text-terra-bright" : "text-sand"
                }`}
              >
                {GROUP_LABEL[g]}
              </h3>
              <span className="font-mono text-[10.5px] text-sand tabular-nums">{list.length}</span>
            </header>
            <ul>
              {shown.map((t) => (
                <TodoRow key={t.id} todo={t} today={today} now={now} names={namesFor(t.assignees)} onToggle={onToggle} onOpen={onOpen} />
              ))}
            </ul>
            {g === "done" && list.length > DONE_PREVIEW && (
              <button
                type="button"
                onClick={() => setAllDone((v) => !v)}
                className="block min-h-9 w-full border-t border-cream/[0.06] px-3 text-left text-[11.5px] text-sand hover:text-cream"
              >
                {allDone ? "Show fewer" : `Show all ${list.length} done in the last 30 days`}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

function TodoRow({
  todo,
  today,
  now,
  names,
  onToggle,
  onOpen,
}: {
  todo: Todo;
  today: string;
  now: number;
  names: string[];
  onToggle: (todo: Todo) => void;
  onOpen: (id: string) => void;
}) {
  const done = todo.status === "done";
  return (
    <li className="flex items-center gap-1 border-b border-cream/[0.05] pr-3 last:border-0 hover:bg-cream/[0.025]">
      <button
        type="button"
        onClick={() => onToggle(todo)}
        aria-label={done ? `Reopen "${todo.title}"` : `Mark "${todo.title}" done`}
        className="flex h-11 w-11 shrink-0 items-center justify-center"
      >
        <span
          className={`flex h-4 w-4 items-center justify-center border transition-colors ${
            done ? "border-terra bg-terra text-cream" : "border-cream/30 hover:border-terra/70"
          }`}
        >
          {done && <Icon.check size={11} />}
        </span>
      </button>
      <button type="button" onClick={() => onOpen(todo.id)} className="min-w-0 flex-1 py-2 text-left">
        <span className={`block truncate text-[13px] ${done ? "text-sand line-through" : "text-cream"}`}>{todo.title}</span>
        <TodoMeta todo={todo} today={today} now={now} />
      </button>
      <AvatarStack names={names} max={3} size={22} />
    </li>
  );
}
