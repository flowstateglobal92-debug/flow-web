"use client";

// `Icon` lives in a "use client" module and is exported as an object, so its
// members are only reachable from another client component.
import { Icon } from "@/components/os/ui";

/* The places the work lives before there is a system. */
const STACK = [
  "WhatsApp",
  "Spreadsheets",
  "Email threads",
  "Sticky notes",
  "Invoice book",
  "Calendar",
  "Reminders",
  "Client folders",
];

/* What replaces it: three functions on one record. */
const LAYER: { id: "pipeline" | "inbox" | "finance"; label: string; meta: string }[] = [
  { id: "inbox", label: "Sales", meta: "Enquiry → qualified → booked" },
  { id: "pipeline", label: "Delivery", meta: "Signed → project → milestones" },
  { id: "finance", label: "Finance", meta: "Invoice → cadence → collected" },
];

/**
 * The section's argument as one panel: the scattered stack on the left, the
 * single operating layer on the right. Nothing moves position — the only
 * motion is light travelling along the shared record, so it reads as calm.
 */
export default function StackContrast() {
  return (
    <div className="glass relative overflow-hidden rounded-3xl">
      <div className="glow-terra pointer-events-none absolute -right-24 top-1/2 h-72 w-72 -translate-y-1/2 opacity-40" />

      <div className="relative grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.1fr)]">
        {/* ── Before: the usual stack ── */}
        <div className="flex flex-col border-b border-cream/10 p-6 sm:p-8 lg:border-b-0">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-sand">The usual stack</p>
            <span className="font-mono text-[10px] text-sand/70 tabular-nums">08</span>
          </div>

          <ul className="mt-5 grid grid-cols-2 gap-2">
            {STACK.map((t) => (
              <li
                key={t}
                className="glass-inset flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[12px] text-sand"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cream/20" />
                <span className="truncate">{t}</span>
              </li>
            ))}
          </ul>

          <p className="mt-auto border-t border-cream/[0.07] pt-4 text-[12.5px] leading-relaxed text-sand [margin-top:1.25rem] lg:[margin-top:auto]">
            Eight places to look. <span className="text-cream-2">None of them talk to each other.</span>
          </p>
        </div>

        {/* ── The turn ── */}
        <div className="relative flex items-center justify-center px-6 pb-2 lg:px-0 lg:py-8">
          {/* horizontal rule on mobile, vertical on desktop */}
          <span className="absolute inset-x-6 top-0 h-px bg-cream/10 lg:inset-x-auto lg:inset-y-8 lg:left-1/2 lg:h-auto lg:w-px" />
          <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-ink text-terra-bright ring-1 ring-terra/30">
            <span className="glow-terra absolute inset-[-40%] opacity-60" />
            <span className="relative rotate-90 lg:rotate-0">
              <Icon.arrow size={16} />
            </span>
          </span>
        </div>

        {/* ── After: one operating layer ── */}
        <div className="flex flex-col p-6 sm:p-8">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-terra-bright">
              One operating layer
            </p>
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-sand">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-300" />
              Live
            </span>
          </div>

          <ul className="mt-5 space-y-2">
            {LAYER.map((m) => {
              const I = Icon[m.id];
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-3.5 rounded-xl border border-terra/20 bg-terra/[0.06] px-3.5 py-3"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-terra/15 text-terra-bright ring-1 ring-terra/25">
                    <I size={17} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium leading-tight text-cream">{m.label}</span>
                    <span className="block truncate text-[11.5px] text-sand">{m.meta}</span>
                  </span>
                </li>
              );
            })}
          </ul>

          {/* The shared record underneath — the only thing that moves is the light on it. */}
          <div className="relative mt-3 overflow-hidden rounded-xl border border-cream/10 bg-ink/50 px-3.5 py-3">
            <span className="shimmer pointer-events-none absolute inset-0" />
            <div className="relative flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-sand">
                One shared record
              </span>
              <span className="font-mono text-[10.5px] text-cream-2">customer · history · money</span>
            </div>
          </div>

          <p className="mt-5 border-t border-cream/[0.07] pt-4 text-[12.5px] leading-relaxed text-cream-2 lg:mt-auto">
            One place to look. <span className="text-cream">Everything already connected.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
