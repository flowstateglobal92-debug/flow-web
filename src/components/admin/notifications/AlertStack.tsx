"use client";

import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { NotificationGlyph, typeMeta } from "./NotificationItem";
import type { NotificationRow } from "@/lib/admin/types";

/** How long an alert stays up before it fades away on its own. */
const SHOW_MS = 6000;
const FADE_MS = 300;

/**
 * New-notification alerts in the top-right corner (under the bar on phones).
 * Each one fades in where it lands and fades out where it is — nothing slides.
 * Hovering holds it; the close button is the touch way out.
 */
export default function AlertStack({
  alerts,
  nameOf,
  onOpen,
  onDismiss,
}: {
  alerts: NotificationRow[];
  nameOf: (id: string | null) => string | null;
  onOpen: (n: NotificationRow) => void;
  onDismiss: (id: string) => void;
}) {
  // Always mounted, even empty: a live region has to exist before its first
  // message lands or screen readers skip it. Empty, it's invisible and inert.
  return (
    <div
      // --top-right-offset: the desktop app's update notice, when it shows above the toasts.
      className="pointer-events-none fixed inset-x-3 top-[60px] z-[115] flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:top-[calc(1rem+var(--top-right-offset,0px))] sm:w-[340px]"
      aria-live="polite"
      aria-relevant="additions"
      data-shell-chrome
    >
      {alerts.map((n) => (
        <Alert key={n.id} n={n} actor={nameOf(n.actor_id)} onOpen={onOpen} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function Alert({
  n,
  actor,
  onOpen,
  onDismiss,
}: {
  n: NotificationRow;
  actor: string | null;
  onOpen: (n: NotificationRow) => void;
  onDismiss: (id: string) => void;
}) {
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (held || leaving) return;
    const t = setTimeout(() => setLeaving(true), SHOW_MS);
    return () => clearTimeout(t);
  }, [held, leaving]);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => onDismiss(n.id), FADE_MS);
    return () => clearTimeout(t);
  }, [leaving, n.id, onDismiss]);

  return (
    <div
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      className={`os-drawer pointer-events-auto flex items-start transition-opacity duration-300 starting:opacity-0 motion-reduce:transition-none ${
        leaving ? "opacity-0" : "opacity-100"
      }`}
    >
      <button
        type="button"
        onClick={() => onOpen(n)}
        className="flex min-w-0 flex-1 items-start gap-3 px-3.5 py-3 text-left"
      >
        <NotificationGlyph n={n} actor={actor} size={30} />
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[9.5px] uppercase tracking-[0.18em] text-terra-bright">
            {typeMeta(n.type).label}
          </span>
          <span className="mt-0.5 block text-[12.5px] font-medium leading-snug text-cream">{n.title}</span>
          {n.body && <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-sand">{n.body}</span>}
        </span>
      </button>
      <button
        type="button"
        onClick={() => setLeaving(true)}
        aria-label="Dismiss"
        className="mr-1 mt-1 flex h-9 w-9 shrink-0 items-center justify-center text-sand transition-colors hover:bg-cream/10 hover:text-cream sm:h-7 sm:w-7"
      >
        <Icon.close size={14} />
      </button>
    </div>
  );
}
