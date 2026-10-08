"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";
import { Tabs } from "../Tabs";
import { NotificationItem } from "./NotificationItem";
import { useNotifications } from "./NotificationsProvider";
import type { NotificationRow } from "@/lib/admin/types";

type View = "all" | "unread";
type Place = { top: number; left: number; width: number };

/**
 * The bell in the rail header and the mobile bar, and its popover.
 *
 * CONTRACT: default export, props `{ compact?: boolean }` (compact = mobile bar).
 * The popover is portalled to <body> — the rail and the bar both blur their
 * backdrop, which would otherwise trap a fixed child inside them.
 */
export default function Bell({ compact = false }: { compact?: boolean }) {
  const { items, unread, markRead, markAllRead, nameOf, loadPeople } = useNotifications();
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [view, setView] = useState<View>("all");
  const open = place !== null;

  const toggle = () => {
    if (open || !button.current) {
      setPlace(null);
      return;
    }
    const r = button.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const width = Math.min(380, vw - 24);
    // Phones get an edge-to-edge sheet under the bar; wider screens anchor to the bell.
    const left = vw < 640 ? 12 : Math.min(Math.max(12, r.right - width), vw - width - 12);
    setPlace({ top: r.bottom + 8, left, width });
    loadPeople();
  };

  // Escape and the backdrop hand focus back to the bell; following a link doesn't.
  const dismiss = () => {
    setPlace(null);
    button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    // The popover is portalled to the end of <body>: move focus into it, or
    // the next Tab would land on the page behind the backdrop.
    dialog.current?.focus();
    const close = () => setPlace(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        button.current?.focus();
      }
    };
    // The popover is placed once, from the bell's rect. A width change moves
    // the bell; height changes (mobile toolbars collapsing) don't.
    const width = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth !== width) close();
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const shown = view === "unread" ? items.filter((n) => !n.read_at) : items;

  const openItem = (n: NotificationRow) => {
    if (!n.read_at) markRead(n.id);
    if (n.link) setPlace(null);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        title="Notifications"
        className={`relative flex items-center justify-center transition-colors hover:bg-cream/[0.06] hover:text-cream ${
          open ? "bg-cream/[0.06] text-cream" : "text-sand"
        } ${compact ? "h-9 w-9 border border-cream/12" : "h-8 w-8"}`}
      >
        <Icon.bell size={16} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[16px] bg-terra px-1 text-center font-mono text-[9.5px] leading-[16px] text-on-terra tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {place &&
        createPortal(
          <div className="fixed inset-0 z-[105]" data-shell-chrome>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Close notifications"
              onClick={dismiss}
              className="absolute inset-0 cursor-default"
            />
            <div
              ref={dialog}
              tabIndex={-1}
              role="dialog"
              aria-label="Notifications"
              className="os-drawer absolute flex flex-col focus:outline-none transition-opacity duration-200 starting:opacity-0 motion-reduce:transition-none"
              style={{ top: place.top, left: place.left, width: place.width, maxHeight: `calc(100dvh - ${place.top + 12}px)` }}
            >
              <header className="flex items-center justify-between gap-3 border-b border-cream/[0.09] px-4 py-3">
                <div className="min-w-0">
                  <h2 className="font-display text-[14px] font-medium text-cream">Notifications</h2>
                  <p className="mt-0.5 text-[11px] text-sand">{unread ? `${unread} unread` : "You're all caught up."}</p>
                </div>
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={unread === 0}
                  className="flex min-h-9 shrink-0 items-center gap-1.5 px-2 text-[11.5px] text-sand transition-colors hover:text-cream disabled:opacity-40 sm:min-h-0 sm:py-1"
                >
                  <Icon.check size={13} />
                  Mark all read
                </button>
              </header>

              <div className="border-b border-cream/[0.07] px-4 py-2.5">
                <Tabs<View>
                  size="xs"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: "all", label: "All" },
                    { value: "unread", label: "Unread", count: unread },
                  ]}
                />
              </div>

              <div
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-thin sm:max-h-[440px]"
                data-lenis-prevent
                data-modal
              >
                {shown.length === 0 ? (
                  <p className="px-4 py-10 text-center text-[12px] text-sand">
                    {view === "unread" ? "Nothing unread." : "Nothing here yet — mentions, assignments and reminders land here."}
                  </p>
                ) : (
                  <ul className="divide-y divide-cream/[0.06]">
                    {shown.map((n) => (
                      <li key={n.id}>
                        <NotificationItem n={n} actor={nameOf(n.actor_id)} read={!!n.read_at} onOpen={openItem} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <footer className="border-t border-cream/[0.09]">
                <Link
                  href="/admin/notifications"
                  onClick={() => setPlace(null)}
                  className="flex min-h-10 items-center justify-center gap-1.5 px-4 text-[12px] text-cream-2 transition-colors hover:bg-cream/[0.04] hover:text-cream"
                >
                  See all notifications
                  <Icon.arrow size={13} />
                </Link>
              </footer>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
