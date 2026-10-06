"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Avatar, fieldClass } from "../ui";
import { mentionedIds, personName } from "./mentions";
import type { TeamMember } from "@/lib/admin/types";

/**
 * A textarea that offers teammates when you type "@".
 *
 * CONTRACT (the comment thread and to-do quick-add use it):
 *   <MentionInput value onChange(value, mentionIds) people placeholder? rows? onSubmit? autoFocus?
 *                 label? submitOnEnter? />
 * `people` should already be filtered to who may be mentioned/assigned here.
 * `label` names the box for screen readers (defaults to the placeholder).
 *
 * Mentions are stored as plain "@Full Name" text; the ids handed back are
 * everyone whose "@Name" is still in the text, so deleting a name drops the
 * mention too. ↑↓ pick, Enter/Tab insert, Esc closes, ⌘/Ctrl+Enter submits —
 * or plain Enter with `submitOnEnter` (one-line boxes; Shift+Enter still
 * breaks the line).
 */

type Menu = { start: number; query: string; above: boolean };

const MAX_OPTIONS = 6;

/** The "@query" the caret sits in, if any. One space allowed, for "first last". */
function mentionAt(value: string, caret: number) {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && /[A-Za-z0-9_]/.test(before[at - 1])) return null; // part of an email address
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n@]/.test(query) || /^\s/.test(query) || (query.match(/\s/g) ?? []).length > 1) {
    return null;
  }
  return { start: at, query };
}

function optionsFor(people: TeamMember[], query: string) {
  const q = query.toLowerCase();
  return people
    .filter((p) => {
      const name = personName(p).toLowerCase();
      return !q || name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q)) || p.email.toLowerCase().startsWith(q);
    })
    .slice(0, MAX_OPTIONS);
}

export default function MentionInput({
  value,
  onChange,
  people,
  placeholder,
  rows = 2,
  onSubmit,
  autoFocus,
  label,
  submitOnEnter = false,
}: {
  value: string;
  onChange: (value: string, mentionIds: string[]) => void;
  people: TeamMember[];
  placeholder?: string;
  rows?: number;
  onSubmit?: () => void;
  autoFocus?: boolean;
  label?: string;
  submitOnEnter?: boolean;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [active, setActive] = useState(0);

  const options = menu ? optionsFor(people, menu.query) : [];
  const showing = menu !== null && options.length > 0;
  const current = Math.min(active, Math.max(0, options.length - 1));

  // Recompute the open "@…" from the caret after typing, clicking or arrowing.
  const sync = (el: HTMLTextAreaElement) => {
    const found = el.selectionStart === el.selectionEnd ? mentionAt(el.value, el.selectionStart) : null;
    if (!found) {
      if (menu) setMenu(null);
      return;
    }
    if (menu && menu.start === found.start && menu.query === found.query) return;
    // Open upwards unless the box is near the top of the screen — comment
    // boxes usually sit at the bottom of a thread or a modal.
    const above = el.getBoundingClientRect().top > 260;
    setMenu({ ...found, above });
    setActive(0);
  };

  const emit = (next: string) => onChange(next, mentionedIds(next, people));

  const pick = (person: TeamMember) => {
    if (!menu) return;
    const end = menu.start + 1 + menu.query.length;
    const insert = `@${personName(person)} `;
    const next = value.slice(0, menu.start) + insert + value.slice(end);
    const caret = menu.start + insert.length;
    setMenu(null);
    emit(next);
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(caret, caret);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return; // mid-IME, Enter confirms the word
    if (showing) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((current + step + options.length) % options.length);
        return;
      }
      if ((e.key === "Enter" && !e.metaKey && !e.ctrlKey) || e.key === "Tab") {
        e.preventDefault();
        pick(options[current]);
        return;
      }
      if (e.key === "Escape") {
        // Close the list, not the modal this box may sit in.
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        setMenu(null);
        return;
      }
    }
    if (e.key === "Enter" && onSubmit && (e.metaKey || e.ctrlKey || (submitOnEnter && !e.shiftKey && !e.altKey))) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={box}
        value={value}
        rows={rows}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        aria-autocomplete="list"
        aria-controls={showing ? listId : undefined}
        aria-activedescendant={showing ? `${listId}-${current}` : undefined}
        onChange={(e) => {
          emit(e.target.value);
          sync(e.target);
        }}
        onSelect={(e) => sync(e.currentTarget)}
        onKeyDown={onKeyDown}
        onBlur={() => setMenu(null)}
        className={`${fieldClass} resize-none`}
      />

      {showing && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention someone"
          className={`os-drawer absolute inset-x-0 z-30 max-h-60 overflow-y-auto py-1 scroll-thin ${
            menu.above ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          data-lenis-prevent
        >
          {options.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              // Keep focus in the textarea so the caret survives the pick.
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => i !== current && setActive(i)}
              onClick={() => pick(p)}
              className={`flex min-h-10 cursor-pointer items-center gap-2.5 px-3 py-1.5 ${
                i === current ? "bg-terra/[0.12] text-cream" : "text-cream-2"
              }`}
            >
              <Avatar name={personName(p)} size={22} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium">{personName(p)}</span>
                <span className="block truncate text-[10.5px] text-sand">{p.title || p.email}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
