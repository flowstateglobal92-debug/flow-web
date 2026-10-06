"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Icon } from "@/components/admin/icons";
import { AvatarStack } from "@/components/admin/ui";
import { STATUSES, STATUS_LABEL, byPosition, type Todo, type TodoStatus } from "./model";
import TodoMeta from "./TodoMeta";

export type Move = { id: string; status: TodoStatus; positions: { id: string; position: number }[] };

/**
 * dnd-kit starts a keyboard drag on Space or Enter by default. Enter belongs
 * to opening the card, so only Space picks one up; Enter still drops it.
 */
const KEYBOARD_CODES = { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter", "Tab"] };

const noop = () => () => {};

/* ─────────────────────────────── card ──────────────────────────────── */

function Card({
  todo,
  index,
  today,
  now,
  names,
  onOpen,
  overlay,
}: {
  todo: Todo;
  index?: number;
  today: string;
  now: number;
  names: string[];
  onOpen?: () => void;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({ id: todo.id, disabled: overlay });
  const { setNodeRef: dropRef } = useDroppable({
    id: `card:${todo.id}`,
    disabled: overlay,
    data: { type: "card", status: todo.status, todoId: todo.id, index },
  });

  return (
    <div
      ref={(node) => {
        dragRef(node);
        dropRef(node);
      }}
      {...listeners}
      {...attributes}
      onClick={onOpen}
      // Enter opens the card (Space picks it up to move — see KEYBOARD_CODES).
      onKeyDown={(e) => {
        if (e.key === "Enter" && !isDragging) {
          e.preventDefault();
          onOpen?.();
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
      className={`group relative select-none border p-3 text-left transition-[box-shadow,border-color,background-color] ${
        overlay
          ? "pointer-events-none cursor-grabbing border-terra/60 bg-ink-2 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.9)] ring-1 ring-terra/50"
          : isDragging
            ? "cursor-grabbing border-dashed border-cream/20 bg-transparent opacity-30"
            : "cursor-grab border-cream/10 bg-cream/[0.035] hover:border-cream/25 hover:bg-cream/[0.06]"
      }`}
    >
      <p className={`line-clamp-2 pr-4 text-[12.5px] leading-snug ${todo.status === "done" ? "text-sand line-through" : "text-cream"}`}>
        {todo.title}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1">
          <TodoMeta todo={todo} today={today} now={now} />
        </span>
        <AvatarStack names={names} max={3} size={20} />
      </div>
      <span className="pointer-events-none absolute right-2 top-2 text-cream/0 transition-colors group-hover:text-cream/25">
        <Icon.drag size={13} />
      </span>
    </div>
  );
}

/* ────────────────────────────── column ─────────────────────────────── */

function Column({
  status,
  todos,
  today,
  now,
  namesFor,
  onOpen,
  dragging,
}: {
  status: TodoStatus;
  todos: Todo[];
  today: string;
  now: number;
  namesFor: (ids: string[]) => string[];
  onOpen: (id: string) => void;
  dragging: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}`, data: { type: "column", status } });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-[82vw] max-w-[300px] shrink-0 flex-col border p-2.5 transition-colors md:w-auto md:max-w-none md:flex-1 ${
        isOver ? "border-terra/50 bg-terra/[0.07]" : dragging ? "border-cream/[0.12] bg-ink/40" : "border-cream/[0.07] bg-ink/25"
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-2.5 pt-0.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-cream-2">{STATUS_LABEL[status]}</span>
        <span className="bg-cream/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-sand tabular-nums">{todos.length}</span>
      </div>
      <div className="flex min-h-[120px] flex-1 flex-col gap-2">
        {todos.map((t, i) => (
          <Card key={t.id} todo={t} index={i} today={today} now={now} names={namesFor(t.assignees)} onOpen={() => onOpen(t.id)} />
        ))}
        {todos.length === 0 && (
          <div className="flex flex-1 items-center justify-center border border-dashed border-cream/[0.08] px-3 py-6 text-center text-[11px] text-sand/70">
            {dragging ? "Drop here" : "Nothing here"}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────── board ─────────────────────────────── */

/**
 * Open · In progress · Done. Mouse drags after 6px, touch after a 220ms press
 * (so a swipe still scrolls the page), keyboard via dnd-kit's sensor.
 * `todos` is what the scope shows; `all` is the whole list, so a drop made
 * while filtered lands at the right depth in the real column.
 */
export default function TodoBoard({
  todos,
  all,
  today,
  namesFor,
  onOpen,
  onMove,
}: {
  todos: Todo[];
  all: Todo[];
  today: string;
  namesFor: (ids: string[]) => string[];
  onOpen: (id: string) => void;
  onMove: (move: Move) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // The drag overlay portals into document.body — client only, without a mount effect.
  const isClient = useSyncExternalStore(noop, () => true, () => false);
  const now = new Date().getTime();

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { keyboardCodes: KEYBOARD_CODES }),
  );

  const columns = useMemo(() => {
    const map = new Map<TodoStatus, Todo[]>(STATUSES.map((s) => [s, []]));
    for (const t of todos) map.get(t.status)?.push(t);
    for (const [s, list] of map) {
      if (s === "done") list.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
      else list.sort(byPosition);
    }
    return map;
  }, [todos]);

  const active = all.find((t) => t.id === activeId) ?? null;

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const id = String(event.active.id);
    const data = event.over?.data.current as { type: "column" | "card"; status: TodoStatus; todoId?: string } | undefined;
    const todo = all.find((t) => t.id === id);
    if (!data || !todo) return;

    const target = data.status;
    if (target === "done") {
      // Done is ordered by when things finished — only the status changes.
      if (todo.status !== "done") onMove({ id, status: target, positions: [] });
      return;
    }

    const column = all.filter((t) => t.status === target && t.id !== id).sort(byPosition);
    const index =
      data.type === "card" && data.todoId ? Math.max(0, column.findIndex((t) => t.id === data.todoId)) : column.length;
    const order = [...column];
    order.splice(index, 0, todo);

    // Send only the positions that actually change.
    const positions = order
      .map((t, i) => ({ id: t.id, position: i, was: t.position }))
      .filter((p) => p.position !== p.was || p.id === id)
      .map(({ id: pid, position }) => ({ id: pid, position }));
    if (todo.status === target && positions.length === 1 && positions[0].position === todo.position) return;
    onMove({ id, status: target, positions });
  };

  return (
    <DndContext
      id="todo-board"
      sensors={sensors}
      autoScroll={{ threshold: { x: 0.15, y: 0.1 } }}
      onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="scroll-x scroll-thin -mx-1 flex items-stretch gap-2.5 overflow-x-auto px-1 pb-3" data-lenis-prevent>
        {STATUSES.map((s) => (
          <Column
            key={s}
            status={s}
            todos={columns.get(s) ?? []}
            today={today}
            now={now}
            namesFor={namesFor}
            onOpen={onOpen}
            dragging={!!activeId}
          />
        ))}
      </div>

      {isClient &&
        createPortal(
          <DragOverlay zIndex={9999} dropAnimation={{ duration: 200, easing: "cubic-bezier(0.22,1,0.36,1)" }}>
            {active ? <Card todo={active} today={today} now={now} names={namesFor(active.assignees)} overlay /> : null}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}
