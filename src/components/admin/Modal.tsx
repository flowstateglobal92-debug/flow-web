"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

/**
 * Centred glass dialog. Escape and backdrop click close it; focus moves inside
 * on open and body scroll is locked while it's up.
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/80 backdrop-blur-[3px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`os-drawer rise-in relative z-10 w-full ${width} my-auto`}
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
            className="flex h-7 w-7 shrink-0 items-center justify-center text-sand transition-colors hover:bg-cream/10 hover:text-cream"
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
