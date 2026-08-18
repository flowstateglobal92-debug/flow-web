"use client";

import { useActionState, useId, useState } from "react";
import { usePathname } from "next/navigation";
import { submitInquiry, type ContactState } from "@/app/actions/contact";

export const FOCUS_OPTIONS = [
  "Lead response",
  "Follow-up",
  "Proposals & onboarding",
  "Collections",
  "Reporting & oversight",
  "Something else",
] as const;

const initialState: ContactState = { status: "idle" };

const field =
  "w-full rounded-xl border border-cream/10 bg-ink/50 px-3.5 py-2.5 text-[13.5px] text-cream placeholder:text-sand/60 transition-[border-color,box-shadow,background-color] duration-300 hover:border-cream/20 focus:border-terra/60 focus:bg-ink/70 focus:outline-none focus:ring-4 focus:ring-terra/15";
const label = "mb-1.5 block text-[10px] uppercase tracking-[0.16em] text-sand";

/**
 * The walkthrough request form. Lives inside a `.glass-inset` card wherever it
 * is placed (contact page, CTA blocks). `withMessage` adds a free-text field.
 */
export default function WalkthroughForm({ withMessage = false }: { withMessage?: boolean }) {
  const uid = useId();
  const pathname = usePathname();
  const [state, action, pending] = useActionState(submitInquiry, initialState);
  // Which confirmation the visitor has already dismissed via "send another".
  const [dismissed, setDismissed] = useState<string | null>(null);

  const id = (k: string) => `${uid}-${k}`;

  if (state.status === "sent" && state.id !== dismissed) {
    const done = { name: state.name ?? "", focus: state.focus || FOCUS_OPTIONS[0] };
    return (
      <div className="rise-in" role="status" aria-live="polite">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-terra text-cream shadow-[0_0_0_4px_rgba(198,93,59,0.2)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="m5 12 4.5 4.5L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="font-display text-[17px] font-medium leading-snug text-cream">
              Thanks{done.name ? `, ${done.name.split(" ")[0]}` : ""} — we&apos;ll reply within one working day with
              2–3 slot options.
            </p>
            <p className="mt-2 text-[12.5px] text-sand">
              We&apos;ll come prepared with examples for <span className="text-cream-2">{done.focus.toLowerCase()}</span>.
            </p>
          </div>
        </div>
        <div className="mt-5 rounded-xl border border-cream/[0.08] bg-cream/[0.03] px-3.5 py-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-sand">What happens next</p>
          <ol className="mt-2 space-y-1.5 text-[12.5px] text-cream-2">
            {["We confirm a slot on WhatsApp or email", "30-minute mapping call", "You receive the automation map"].map(
              (t, i) => (
                <li key={t} className="flex items-center gap-2.5">
                  <span className="font-mono text-[10px] text-terra-bright">0{i + 1}</span>
                  {t}
                </li>
              ),
            )}
          </ol>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(state.id ?? null)}
          className="mt-4 text-[12px] text-sand underline-offset-4 transition-colors hover:text-cream hover:underline"
        >
          Send another request
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="page" value={pathname} />
      {/* Honeypot — hidden from people, tempting to bots. */}
      <input
        type="text"
        name="company_website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="absolute left-[-9999px] h-px w-px opacity-0"
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={id("name")} className={label}>
            Name
          </label>
          <input id={id("name")} name="name" type="text" required autoComplete="name" placeholder="Your name" className={field} />
        </div>
        <div>
          <label htmlFor={id("business")} className={label}>
            Business
          </label>
          <input
            id={id("business")}
            name="business"
            type="text"
            autoComplete="organization"
            placeholder="Company or trading name"
            className={field}
          />
        </div>
      </div>
      <div>
        <label htmlFor={id("contact")} className={label}>
          WhatsApp / email
        </label>
        <input
          id={id("contact")}
          name="contact"
          type="text"
          required
          inputMode="email"
          autoComplete="email"
          placeholder="+94 7… or you@business.com"
          className={field}
        />
      </div>
      <div>
        <label htmlFor={id("focus")} className={label}>
          What slows you down most?
        </label>
        <div className="relative">
          <select id={id("focus")} name="focus" defaultValue={FOCUS_OPTIONS[0]} className={`${field} appearance-none pr-10`}>
            {FOCUS_OPTIONS.map((o) => (
              <option key={o} value={o} className="bg-ink text-cream">
                {o}
              </option>
            ))}
          </select>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sand"
          >
            <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      {withMessage && (
        <div>
          <label htmlFor={id("message")} className={label}>
            Anything we should know? <span className="normal-case tracking-normal text-sand/70">(optional)</span>
          </label>
          <textarea
            id={id("message")}
            name="message"
            rows={3}
            placeholder="Your tools, your team size, the step that breaks most often…"
            className={`${field} resize-none`}
          />
        </div>
      )}

      {state.status === "error" && state.error && (
        <p role="alert" className="rounded-xl border border-rose-400/25 bg-rose-500/[0.08] px-3.5 py-2.5 text-[12.5px] text-rose-200">
          {state.error}
        </p>
      )}

      <div className="flex flex-col gap-2.5 pt-1 sm:flex-row sm:items-center">
        <button type="submit" disabled={pending} className="btn btn--primary w-full disabled:opacity-70 sm:w-auto">
          {pending ? "Sending…" : "Request my walkthrough"}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <a href="#" className="btn btn--ghost w-full sm:w-auto">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M4 20l1.3-4A8.5 8.5 0 1 1 8.5 19z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M9.5 9.5c0 3 2 5 5 5l1-1.5-2-1-1 .8a3.5 3.5 0 0 1-1.6-1.6l.8-1-1-2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          Or WhatsApp us
        </a>
      </div>
    </form>
  );
}
