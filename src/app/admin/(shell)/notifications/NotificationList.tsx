"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Icon } from "@/components/admin/icons";
import { RouteTabs } from "@/components/admin/Tabs";
import { Button, EmptyState, Panel } from "@/components/admin/ui";
import { personName } from "@/components/admin/comments/mentions";
import { NotificationItem } from "@/components/admin/notifications/NotificationItem";
import { useNotifications } from "@/components/admin/notifications/NotificationsProvider";
import type { NotificationRow, TeamMember } from "@/lib/admin/types";

const pageHref = (filter: "all" | "unread", page: number) => {
  const qs = new URLSearchParams();
  if (filter === "unread") qs.set("filter", "unread");
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `/admin/notifications?${s}` : "/admin/notifications";
};

export default function NotificationList({
  items,
  people,
  filter,
  page,
  pages,
  total,
  beyond,
}: {
  items: NotificationRow[];
  people: TeamMember[];
  filter: "all" | "unread";
  page: number;
  pages: number;
  total: number;
  beyond: boolean;
}) {
  // Reading here goes through the provider, so the bell's count drops with it.
  const live = useNotifications();

  // Rows read on this page since the server rendered it. Reset when a new page arrives.
  const [readHere, setReadHere] = useState<string[]>([]);
  const [allRead, setAllRead] = useState(false);
  const [seed, setSeed] = useState(items);
  if (seed !== items) {
    setSeed(items);
    setReadHere([]);
    setAllRead(false);
  }

  const names = useMemo(() => new Map(people.map((p) => [p.id, personName(p)])), [people]);
  // Anything the bell has marked read counts too.
  const readInBell = useMemo(() => new Set(live.items.filter((n) => n.read_at).map((n) => n.id)), [live.items]);
  const isRead = (n: NotificationRow) => allRead || !!n.read_at || readHere.includes(n.id) || readInBell.has(n.id);

  const open = (n: NotificationRow) => {
    if (isRead(n)) return;
    live.markRead(n.id);
    setReadHere((ids) => [...ids, n.id]);
  };

  const markAll = () => {
    live.markAllRead();
    setAllRead(true);
  };

  const anyUnread = !allRead && live.unread > 0;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <RouteTabs
          tabs={[
            { href: "/admin/notifications", label: "All", param: { key: "filter", value: "all", isDefault: true } },
            {
              href: "/admin/notifications?filter=unread",
              label: "Unread",
              count: allRead ? 0 : live.unread,
              param: { key: "filter", value: "unread" },
            },
          ]}
        />
        <Button onClick={markAll} disabled={!anyUnread} className="min-h-9 sm:min-h-0">
          <Icon.check size={13} />
          Mark all read
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title={beyond ? "No more notifications" : filter === "unread" ? "Nothing unread" : "No notifications yet"}
          hint={
            beyond
              ? "This page is past the end of the list."
              : filter === "unread"
                ? "You're all caught up."
                : "Mentions, assignments, reminders and approvals will show up here."
          }
          action={
            beyond ? (
              <Link href={pageHref(filter, 1)} className="text-[12px] text-terra-bright hover:text-cream">
                Back to the newest
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Panel bodyClass="p-0">
          <ul className="divide-y divide-cream/[0.06]">
            {items.map((n) => (
              <li key={n.id}>
                <NotificationItem n={n} actor={n.actor_id ? (names.get(n.actor_id) ?? null) : null} read={isRead(n)} onOpen={open} />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Pages">
          <PageLink href={page > 1 ? pageHref(filter, page - 1) : null} label="Newer" icon={<Icon.chevronLeft size={14} />} />
          <span className="min-w-0 text-center font-mono text-[11px] text-sand tabular-nums">
            Page {page} of {pages}
            <span className="hidden sm:inline"> · {total} total</span>
          </span>
          <PageLink
            href={page < pages ? pageHref(filter, page + 1) : null}
            label="Older"
            icon={<Icon.chevronRight size={14} />}
            after
          />
        </nav>
      )}
    </>
  );
}

function PageLink({ href, label, icon, after = false }: { href: string | null; label: string; icon: ReactNode; after?: boolean }) {
  const cls =
    "inline-flex min-h-9 items-center gap-1.5 border px-3 text-[12px] font-medium transition-colors duration-300 sm:min-h-8";
  if (!href) {
    return (
      <span className={`${cls} border-cream/[0.06] text-sand/50`} aria-disabled>
        {!after && icon}
        {label}
        {after && icon}
      </span>
    );
  }
  return (
    <Link href={href} className={`${cls} border-cream/12 bg-cream/[0.03] text-cream-2 hover:border-cream/30 hover:text-cream`}>
      {!after && icon}
      {label}
      {after && icon}
    </Link>
  );
}
