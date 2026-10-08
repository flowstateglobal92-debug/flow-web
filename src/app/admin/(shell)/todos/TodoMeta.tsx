import { Fragment, type ReactNode } from "react";
import { PRIORITY_LABEL, dueLabel, isOverdue, type Todo } from "./model";

/**
 * The one muted mono line under a to-do's title, on list rows and board cards:
 * priority (when not normal) · due · progress · repeat · private. Labels stay
 * in the drawer — cards carry no chip rows.
 */
export default function TodoMeta({ todo, today, now }: { todo: Todo; today: string; now: number }) {
  const parts: ReactNode[] = [];
  if (todo.priority !== "normal") {
    const tone = todo.priority === "urgent" ? "text-bad-300" : todo.priority === "high" ? "text-terra-bright" : "";
    parts.push(<span className={tone}>{PRIORITY_LABEL[todo.priority].toUpperCase()}</span>);
  }
  parts.push(<span className={isOverdue(todo, today, now) ? "text-bad-300" : ""}>{dueLabel(todo, today)}</span>);
  if (todo.status === "in_progress") parts.push("In progress");
  if (todo.checklist.length) {
    parts.push(`${todo.checklist.filter((c) => c.done).length}/${todo.checklist.length}`);
  }
  if (todo.recurrence !== "none") parts.push(`Repeats ${todo.recurrence}`);
  if (todo.is_private) parts.push("Private");

  return (
    <span className="block truncate font-mono text-[10.5px] text-sand">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && " · "}
          {p}
        </Fragment>
      ))}
    </span>
  );
}
