"use client";

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

/** Open dialogs, oldest first. Only the top one answers Escape and holds Tab. */
const stack: symbol[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Centred glass dialog. Escape and backdrop click close it; focus moves inside
 * on open, Tab stays inside while it's up, and focus goes back to whatever
 * opened it on close. Body scroll is locked meanwhile. Stacked dialogs (a
 * receipt preview over the entry form) close one Escape at a time.
 */
export default function Modal({
  open,
  onClose,
  title,
  hint,
  children,
  footer,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  hint?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [id] = useState(() => Symbol("modal"));
  // Read the latest onClose without re-running the effect: callers often pass
  // an inline arrow, and re-running would yank focus back to the first field
  // on every parent render while someone is typing.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (stack[stack.length - 1] !== id) return;
    if (e.key === "Escape") {
      e.stopImmediatePropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const root = panel.current;
    const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
    const active = document.activeElement;
    if (items.length === 0) {
      e.preventDefault();
      root.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey ? active === first || !root.contains(active) : active === last || !root.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push(id);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    return () => {
      const at = stack.indexOf(id);
      if (at !== -1) stack.splice(at, 1);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      // Back to the button that opened it, if it's still on the page.
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, id]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-6">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/80 backdrop-blur-[3px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`os-drawer rise-in relative z-10 w-full ${width} my-auto focus:outline-none`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-cream/[0.09] px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-medium text-cream">{title}</h2>
            {hint && <p className="mt-0.5 text-[11.5px] text-sand">{hint}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center text-sand transition-colors hover:bg-cream/10 hover:text-cream pointer-coarse:h-9 pointer-coarse:w-9"
          >
            <Icon.close size={15} />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 scroll-thin" data-lenis-prevent>
          {children}
        </div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-cream/[0.09] px-5 py-3">{footer}</footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
