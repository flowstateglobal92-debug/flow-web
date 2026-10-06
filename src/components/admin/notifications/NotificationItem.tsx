"use client";

import Link from "next/link";
import { Icon, type AdminIcon } from "../icons";
import { Avatar } from "../ui";
import { relativeTime } from "@/lib/admin/format";
import type { NotificationRow } from "@/lib/admin/types";

/** One line of copy and an icon per notification type (the types the triggers write). */
const META: Record<string, { label: string; icon: AdminIcon }> = {
  mention: { label: "Mention", icon: "at" },
  comment: { label: "Comment", icon: "message" },
  todo_assigned: { label: "To-do", icon: "checklist" },
  todo_reminder: { label: "Reminder", icon: "clock" },
  todo_completed: { label: "Done", icon: "check" },
  event_invite: { label: "Invite", icon: "calendar" },
  event_reminder: { label: "Starting soon", icon: "clock" },
  payment_recorded: { label: "Payment", icon: "receipt" },
  invoice_paid: { label: "Paid", icon: "receipt" },
  invoice_overdue: { label: "Overdue", icon: "flag" },
  quote_accepted: { label: "Quote accepted", icon: "receipt" },
  recurring_generated: { label: "Recurring", icon: "repeat" },
  approval_requested: { label: "Approval", icon: "shield" },
  approval_decided: { label: "Decision", icon: "shield" },
  budget_alert: { label: "Budget", icon: "chart" },
  inquiry_new: { label: "Inquiry", icon: "inbox" },
  lead_won: { label: "Won", icon: "star" },
  lead_assigned: { label: "Lead", icon: "pipeline" },
  client_assigned: { label: "Client", icon: "building" },
};

export const typeMeta = (type: string) => META[type] ?? { label: "Alert", icon: "bell" as AdminIcon };

/** The actor's avatar, or the type's icon for system alerts (reminders, overdue…). */
export function NotificationGlyph({ n, actor, size = 28 }: { n: NotificationRow; actor: string | null; size?: number }) {
  if (actor)
    return (
      <span className="shrink-0" title={actor}>
        <Avatar name={actor} size={size} />
      </span>
    );
  const TypeIcon = Icon[typeMeta(n.type).icon];
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-cream/[0.06] text-terra-bright ring-1 ring-cream/12"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <TypeIcon size={Math.round(size * 0.52)} />
    </span>
  );
}

/**
 * A notification row, shared by the bell popover and the full list. It's a
 * link when the alert points somewhere, otherwise a button that just marks it
 * read. `onOpen` runs first either way.
 */
export function NotificationItem({
  n,
  actor,
  read,
  onOpen,
}: {
  n: NotificationRow;
  actor: string | null;
  read: boolean;
  onOpen: (n: NotificationRow) => void;
}) {
  const meta = typeMeta(n.type);
  const inner = (
    <>
      <NotificationGlyph n={n} actor={actor} />
      <span className="min-w-0 flex-1">
        <span className={`block text-[12.5px] leading-snug ${read ? "text-cream-2" : "font-medium text-cream"}`}>
          {n.title}
        </span>
        {n.body && <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-sand">{n.body}</span>}
        <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.08em] text-sand/80">
          {meta.label} · <span suppressHydrationWarning>{relativeTime(n.deliver_at)}</span>
        </span>
      </span>
      {!read && (
        <span className="relative mt-1.5 h-2 w-2 shrink-0 rounded-full bg-terra">
          <span className="sr-only">Unread</span>
        </span>
      )}
    </>
  );

  const cls = `flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left transition-colors duration-300 hover:bg-cream/[0.04] ${
    read ? "" : "bg-terra/[0.05]"
  }`;

  return n.link ? (
    <Link href={n.link} onClick={() => onOpen(n)} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={() => onOpen(n)} className={cls}>
      {inner}
    </button>
  );
}
