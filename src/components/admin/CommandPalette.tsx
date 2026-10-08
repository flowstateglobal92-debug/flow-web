"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon, type AdminIcon } from "./icons";
import { APPROVALS_NAV, MODULES, canAccess, isApprover } from "@/lib/admin/modules";
import { NEW } from "@/lib/admin/links";
import type { AccessKey, SearchResult, ShellProfile } from "@/lib/admin/types";

/**
 * ⌘K — pages, quick actions and global search.
 *
 * CONTRACT (keep these exports):
 *   <CommandPalette profile />      mounted once by the Shell; owns the ⌘K listener
 *   <SearchTrigger compact? />      a button; opens the palette by dispatching
 *                                   window event OPEN_PALETTE_EVENT
 *
 * Pages and quick actions are filtered by what this person can open (the
 * pages re-check). Records come from GET /admin/search, which runs the RLS-
 * bound search_everything RPC — debounced, and each keystroke aborts the last.
 * ⌘↵ (or ⌘-click) opens the pick separately: a new tab on the website, a new
 * window in the desktop app.
 */
export const OPEN_PALETTE_EVENT = "flowstate:open-palette";

type Entry = { key: string; label: string; hint: string | null; href: string; icon: AdminIcon; section: string };

const ACTIONS: { label: string; hint: string; href: string; icon: AdminIcon; needs: AccessKey | "approver" | null }[] = [
  { label: "New invoice", hint: "Invoices", href: NEW.invoice(), icon: "receipt", needs: "invoices" },
  { label: "New quote", hint: "Invoices", href: NEW.quote(), icon: "note", needs: "invoices" },
  { label: "New to-do", hint: "To-dos", href: NEW.todo(), icon: "checklist", needs: "todos" },
  { label: "New event", hint: "Calendar", href: NEW.event(), icon: "calendar", needs: "calendar" },
  { label: "New client", hint: "Clients", href: NEW.client(), icon: "building", needs: "clients" },
  { label: "New expense", hint: "Expenses", href: NEW.expense(), icon: "ledger", needs: "finance" },
  { label: "Request time off", hint: "My account", href: NEW.timeOff(), icon: "plane", needs: null },
  { label: "Review approvals", hint: "Requests waiting on you", href: APPROVALS_NAV.href, icon: "shield", needs: "approver" },
];

const RESULT_LABEL: Record<SearchResult["entity_type"], { section: string; icon: AdminIcon }> = {
  client: { section: "Clients", icon: "building" },
  lead: { section: "Leads", icon: "pipeline" },
  invoice: { section: "Invoices", icon: "receipt" },
  quote: { section: "Quotes", icon: "note" },
  todo: { section: "To-dos", icon: "checklist" },
  event: { section: "Events", icon: "calendar" },
  inquiry: { section: "Inquiries", icon: "inbox" },
};

const matches = (term: string, ...fields: (string | null)[]) =>
  !term || fields.some((f) => f?.toLowerCase().includes(term));

export default function CommandPalette({ profile }: { profile: ShellProfile }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  if (!open || typeof document === "undefined") return null;
  // Mounted fresh on every open, so the query starts empty each time.
  return createPortal(<Palette profile={profile} onClose={() => setOpen(false)} />, document.body);
}

function Palette({ profile, onClose }: { profile: ShellProfile; onClose: () => void }) {
  const router = useRouter();
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<{ q: string; items: SearchResult[]; failed?: boolean }>({ q: "", items: [] });

  const term = query.trim();
  const lower = term.toLowerCase();
  const searchable = term.length >= 2;

  // Debounced record search. State is only set from the timer/fetch callbacks.
  useEffect(() => {
    if (!searchable) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/admin/search?q=${encodeURIComponent(term)}`, {
          signal: ctrl.signal,
          headers: { Accept: "application/json" },
        });
        const data: unknown = res.ok ? await res.json() : [];
        setFound({ q: term, items: Array.isArray(data) ? (data as SearchResult[]) : [] });
      } catch {
        if (!ctrl.signal.aborted) setFound({ q: term, items: [], failed: true });
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [term, searchable]);

  // Lock the page behind the sheet.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const pages = useMemo<Entry[]>(() => {
    const mods = MODULES.filter((m) => canAccess(profile, m.key)).map((m) => ({
      key: `page:${m.href}`,
      label: m.label,
      hint: m.hint,
      href: m.href,
      icon: m.icon,
      section: "Pages",
    }));
    const always: Entry[] = [
      { key: "page:approvals", label: APPROVALS_NAV.label, hint: APPROVALS_NAV.hint, href: APPROVALS_NAV.href, icon: APPROVALS_NAV.icon, section: "Pages" },
      { key: "page:notifications", label: "Notifications", hint: "Everything sent your way", href: "/admin/notifications", icon: "bell", section: "Pages" },
      { key: "page:account", label: "My account", hint: "Profile, password, leave, alerts", href: "/admin/account", icon: "user", section: "Pages" },
    ];
    return [...mods, ...always];
  }, [profile]);

  const actions = useMemo<Entry[]>(
    () =>
      ACTIONS.filter((a) =>
        a.needs === null ? true : a.needs === "approver" ? isApprover(profile) : canAccess(profile, a.needs),
      ).map((a) => ({ key: `action:${a.label}`, label: a.label, hint: a.hint, href: a.href, icon: a.icon, section: "Quick actions" })),
    [profile],
  );

  // Keep showing the last results while the next request is in flight.
  const results: Entry[] = searchable
    ? found.items.map((r) => ({
        key: `${r.entity_type}:${r.id}`,
        label: r.title,
        hint: r.subtitle,
        href: r.href,
        icon: RESULT_LABEL[r.entity_type]?.icon ?? "search",
        section: RESULT_LABEL[r.entity_type]?.section ?? "Results",
      }))
    : [];
  const searching = searchable && found.q !== term;
  const failed = searchable && !searching && !!found.failed;

  const entries = [
    ...pages.filter((p) => matches(lower, p.label, p.hint)),
    ...actions.filter((a) => matches(lower, a.label, a.hint)),
    ...results,
  ];
  const current = Math.min(active, Math.max(0, entries.length - 1));

  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const go = (entry: Entry | undefined, separately = false) => {
    if (!entry) return;
    onClose();
    if (separately) window.open(entry.href, "_blank", "noopener");
    else router.push(entry.href);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.nativeEvent.isComposing) return; // mid-IME, Enter confirms the word
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(entries.length ? (current + 1) % entries.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(entries.length ? (current - 1 + entries.length) % entries.length : 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(entries[current], e.metaKey || e.ctrlKey);
    } else if (e.key === "Escape") {
      // Close the palette only — not a modal that may be open underneath.
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      onClose();
    } else if (e.key === "Tab") {
      // Arrows and Enter drive the list; focus stays in the box (and out of
      // the page behind the sheet, or of a modal's focus trap underneath).
      e.preventDefault();
      e.nativeEvent.stopImmediatePropagation();
      input.current?.focus();
    }
  };

  // Sections in order of first appearance.
  const sections: { name: string; rows: { entry: Entry; index: number }[] }[] = [];
  entries.forEach((entry, index) => {
    const last = sections[sections.length - 1];
    if (last?.name === entry.section) last.rows.push({ entry, index });
    else sections.push({ name: entry.section, rows: [{ entry, index }] });
  });

  return (
    <div
      className="fixed inset-0 z-[110] flex justify-center sm:items-start sm:p-6 sm:pt-[12vh]"
      data-shell-chrome
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close search"
        onClick={onClose}
        className="absolute inset-0 cursor-default scrim backdrop-blur-[3px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className="os-drawer relative flex h-full w-full flex-col transition-opacity duration-200 starting:opacity-0 motion-reduce:transition-none sm:h-auto sm:max-h-[72vh] sm:max-w-xl"
      >
        <div className="flex items-center gap-2.5 border-b border-cream/[0.09] px-4 py-2.5">
          <span className="shrink-0 text-sand">
            <Icon.search size={16} />
          </span>
          <input
            ref={input}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Search clients, leads, invoices, to-dos… or jump to a page"
            aria-label="Search"
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={entries[current] ? `palette-${current}` : undefined}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[14px] text-cream placeholder:text-sand/55 focus:outline-none"
          />
          {searching && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-terra-bright" aria-label="Searching" />}
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-9 shrink-0 items-center px-2 text-[12px] text-sand transition-colors hover:text-cream sm:hidden"
          >
            Cancel
          </button>
          <kbd className="hidden shrink-0 border border-cream/12 px-1.5 py-0.5 font-mono text-[10px] text-sand sm:inline">esc</kbd>
        </div>

        <div
          ref={list}
          id="palette-list"
          role="listbox"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 scroll-thin"
          data-lenis-prevent
          data-modal
        >
          {sections.map((s) => (
            <div key={s.name} className="mb-1.5">
              <p className="px-2.5 pb-1 pt-2 font-mono text-[9.5px] uppercase tracking-[0.22em] text-sand/70">{s.name}</p>
              {s.rows.map(({ entry, index }) => {
                const EntryIcon = Icon[entry.icon];
                const on = index === current;
                return (
                  <button
                    key={entry.key}
                    id={`palette-${index}`}
                    type="button"
                    tabIndex={-1}
                    role="option"
                    aria-selected={on}
                    data-active={on}
                    onMouseMove={() => !on && setActive(index)}
                    onClick={(e) => go(entry, e.metaKey || e.ctrlKey)}
                    className={`flex min-h-11 w-full items-center gap-3 border px-2.5 py-2 text-left transition-colors duration-150 sm:min-h-0 ${
                      on ? "border-terra/40 bg-terra/[0.10] text-cream" : "border-transparent text-cream-2"
                    }`}
                  >
                    <span className={on ? "text-terra-bright" : "text-sand"}>
                      <EntryIcon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium leading-tight">{entry.label}</span>
                      {entry.hint && <span className="block truncate text-[11px] text-sand">{entry.hint}</span>}
                    </span>
                    {on && (
                      <span className="hidden shrink-0 text-sand sm:inline">
                        <Icon.arrow size={13} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {entries.length === 0 && (
            <p className="px-3 py-10 text-center text-[12.5px] text-sand">
              {searching ? "Searching…" : failed ? "Search isn't answering right now." : `Nothing matches “${term}”.`}
            </p>
          )}
          {entries.length > 0 && searchable && !searching && found.items.length === 0 && (
            <p className="px-3 pb-2 pt-1 text-[11.5px] text-sand/80">
              {failed ? "Record search isn't answering right now." : `No records match “${term}”.`}
            </p>
          )}
          {!searchable && (
            <p className="px-3 pb-2 pt-1 text-[11.5px] text-sand/70">Type two or more letters to search records.</p>
          )}
        </div>

        <div className="hidden items-center gap-4 border-t border-cream/[0.09] px-4 py-2 font-mono text-[10px] text-sand/80 sm:flex">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>⌘↵ open separately</span>
          <span>⌘K toggle</span>
        </div>
      </div>
    </div>
  );
}

export function SearchTrigger({ compact = false }: { compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}
      aria-label="Search (⌘K)"
      title="Search (⌘K)"
      className={`flex items-center justify-center text-sand transition-colors hover:bg-cream/[0.06] hover:text-cream ${
        compact ? "h-9 w-9 border border-cream/12" : "h-8 w-8"
      }`}
    >
      <Icon.search size={16} />
    </button>
  );
}
