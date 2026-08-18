"use client";

import Link from "next/link";
import { useState } from "react";
import ScrollReveal from "@/components/ScrollReveal";

const SIGNALS = [
  ["Enquiries arrive on WhatsApp at all hours", "and the first reply depends on who is awake."],
  ["Follow-ups live in someone's head", "so warm leads go cold when the week gets busy."],
  ["Quotes are rebuilt from scratch", "and nobody knows when a proposal was actually opened."],
  ["Invoices are chased by hand", "with reminders that go out when someone remembers."],
  ["Reporting means asking three people", "and reconciling chats, notes and spreadsheets."],
] as const;

const SECTORS = [
  "Agencies & studios",
  "Clinics & wellness",
  "Education & training",
  "Real estate & property",
  "Professional services",
  "Retail & e-commerce",
  "Trades & construction",
  "Hospitality & events",
];

function verdict(n: number) {
  if (n === 0) return "Tick the ones that sound like your week.";
  if (n <= 2) return "Worth a conversation — one or two playbooks would already pay for themselves.";
  if (n <= 4) return "This is exactly the work we automate first. Expect the first wins inside two weeks.";
  return "All five. Your operation is ready for an operating layer — let's map it.";
}

/**
 * Who it's for. Instead of logos we can't show, the visitor self-qualifies:
 * tick the frictions you recognise and the panel tells you what that means.
 */
export default function Fit() {
  const [ticked, setTicked] = useState<boolean[]>(() => SIGNALS.map(() => false));
  const count = ticked.filter(Boolean).length;

  return (
    <section id="fit" className="relative scroll-mt-20 py-20 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="glow-terra absolute left-1/2 top-0 h-[40vh] w-[70vw] -translate-x-1/2 opacity-20" />
      </div>

      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <ScrollReveal className="mx-auto max-w-3xl text-center">
          <p className="eyebrow">Who we work with</p>
          <h2 className="font-display mt-4 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl lg:text-6xl">
            Built for businesses <span className="text-gradient">with real volume.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-relaxed text-cream-2 sm:text-lg">
            Different sectors, the same repeat work. If enquiries, follow-ups, proposals and invoices are moving
            through people instead of a system, this is for you.
          </p>
        </ScrollReveal>

        <ScrollReveal y={56} className="mt-12 sm:mt-16">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-6">
            {/* Self-check */}
            <div className="glass relative overflow-hidden rounded-3xl p-5 sm:p-7">
              <div
                className={`glow-terra pointer-events-none absolute -right-24 -top-24 h-72 w-72 transition-opacity duration-700 ${
                  count >= 3 ? "opacity-50" : "opacity-0"
                }`}
              />
              <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-display text-base font-medium text-cream sm:text-lg">
                    You&apos;ll recognise this if…
                  </p>
                  <p className="mt-1 text-[12.5px] text-sand">
                    <span className="text-cream-2">Tick what sounds familiar.</span> The verdict updates below.
                  </p>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] transition-colors duration-500 ${
                    count >= 3 ? "text-terra-bright" : "text-sand"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full transition-colors duration-500 ${
                      count >= 3 ? "pulse-dot bg-terra-bright" : "bg-sand/60"
                    }`}
                  />
                  {count} of {SIGNALS.length} familiar
                </span>
              </div>

              <ul className="relative mt-6 space-y-2">
                {SIGNALS.map(([lead, rest], i) => {
                  const on = ticked[i];
                  return (
                    <li key={lead}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setTicked((prev) => prev.map((v, j) => (j === i ? !v : v)))
                        }
                        className={`group flex w-full items-start gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-[border-color,background-color] duration-500 ease-[var(--ease-flow)] ${
                          on
                            ? "border-terra/30 bg-terra/[0.07]"
                            : "border-cream/[0.08] bg-cream/[0.025] hover:border-cream/20"
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md ring-1 transition-all duration-500 ${
                            on ? "bg-terra text-cream ring-terra/40 shadow-[0_0_0_4px_rgba(198,93,59,0.18)]" : "bg-cream/[0.04] text-transparent ring-cream/15 group-hover:ring-cream/30"
                          }`}
                          aria-hidden
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                            <path d="m5 12 4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                        <span className="text-[13.5px] leading-snug">
                          <span className={`font-medium transition-colors duration-300 ${on ? "text-cream" : "text-cream-2"}`}>{lead}</span>{" "}
                          <span className="text-sand">{rest}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="relative mt-6 flex flex-col gap-3 border-t border-cream/[0.07] pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p key={count} className="rise-in text-[13px] leading-relaxed text-cream-2">
                  {verdict(count)}
                </p>
                <Link href="/contact" className="btn btn--ghost btn--sm shrink-0">
                  Book a walkthrough
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </div>
            </div>

            {/* Sectors */}
            <aside className="glass rounded-3xl p-5 sm:p-6">
              <p className="eyebrow eyebrow--muted text-[10px]">Where the same work shows up</p>
              <ul className="mt-4 divide-y divide-cream/[0.07]">
                {SECTORS.map((s, i) => (
                  <li key={s} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="font-mono text-[10px] text-terra-bright tabular-nums">0{i + 1}</span>
                    <span className="text-[13.5px] text-cream-2">{s}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 border-t border-cream/[0.07] pt-4 text-[12px] leading-relaxed text-sand">
                Not on the list? The question isn&apos;t the sector — it&apos;s whether the same steps repeat every week.
              </p>
            </aside>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
