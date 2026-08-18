"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ScrollTrigger } from "@/lib/gsap";
import ScrollReveal from "@/components/ScrollReveal";
import { Icon, Pill } from "@/components/os/ui";

/* ───────────── Content ───────────── */
type Mode = "before" | "after";

const ROWS: { area: string; before: string; after: string }[] = [
  {
    area: "Lead response",
    before: "Depends on staff availability",
    after: "Always-on acknowledgement and routing",
  },
  {
    area: "Follow-up",
    before: "Memory and ad hoc reminders",
    after: "Rules, promises and next-best actions",
  },
  {
    area: "Proposal to project",
    before: "Manual re-entry across teams",
    after: "Signature starts the onboarding chain",
  },
  {
    area: "Collections",
    before: "Irregular reminder messages",
    after: "Scheduled cadence with escalation",
  },
  {
    area: "Oversight",
    before: "Chats, notes and spreadsheets",
    after: "One dashboard and shared client history",
  },
];

const IMPACT: { label: string; text: string }[] = [
  { label: "Admin capacity", text: "Less scheduling, copy-paste, status chasing and record updating." },
  { label: "Revenue leakage", text: "Fewer missed inquiries, forgotten commitments and cold leads." },
  { label: "Cash collection", text: "A consistent reminder cadence and clearer outstanding balances." },
  { label: "Tool sprawl", text: "Fewer duplicate trackers, disconnected handoffs and shadow systems." },
];

/* Small "friction" glyph for the Before state — a broken / interrupted line. */
function FrictionGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 12h5" />
      <path d="M11 9.5 13 12l-2 2.5" />
      <path d="M15 12h5" strokeDasharray="1.5 2.5" />
    </svg>
  );
}

/* ───────────── Segmented control ───────────── */
function Segmented({
  mode,
  onChange,
  labelId,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  labelId: string;
}) {
  const options: { id: Mode; label: string }[] = [
    { id: "before", label: "Before" },
    { id: "after", label: "With Flow State" },
  ];
  return (
    <div
      role="tablist"
      aria-labelledby={labelId}
      className="relative inline-grid grid-cols-2 rounded-none border border-cream/12 bg-ink/50 p-1"
    >
      {/* Sliding thumb */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-none bg-gradient-to-b from-[#e2805a] via-terra to-[#b4522f] shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_24px_-10px_rgba(198,93,59,0.9)] transition-transform duration-500 ease-[var(--ease-flow)]"
        style={{ transform: mode === "after" ? "translateX(100%)" : "translateX(0%)" }}
      />
      {options.map((o) => {
        const active = mode === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            className={`relative z-10 whitespace-nowrap rounded-none px-4 py-2 text-[12.5px] font-medium transition-colors duration-300 sm:px-5 ${
              active ? "text-[#fff8f2]" : "text-cream-2 hover:text-cream"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────── Row ───────────── */
function ShiftRow({
  row,
  mode,
  index,
}: {
  row: (typeof ROWS)[number];
  mode: Mode;
  index: number;
}) {
  const after = mode === "after";
  // Slight stagger so the switch reads as a wave down the list, not a flash.
  const delay = `${index * 55}ms`;
  return (
    <li className="grid gap-2 border-t border-cream/[0.07] py-3.5 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-[196px_1fr] sm:items-center sm:gap-6 lg:grid-cols-[212px_1fr]">
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[10px] text-terra-bright tabular-nums">0{index + 1}</span>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-sand">{row.area}</span>
      </div>

      <div
        className={`relative overflow-hidden rounded-2xl border transition-colors duration-500 ease-[var(--ease-flow)] ${
          after ? "border-terra/25 bg-terra/[0.06]" : "border-cream/[0.08] bg-cream/[0.025]"
        }`}
        style={{ transitionDelay: delay }}
      >
        {/* Grid stacks both states in the same cell so height is stable. */}
        <div className="grid">
          <div
            aria-hidden={after}
            className={`col-start-1 row-start-1 flex items-center gap-3 px-3.5 py-3 transition-[opacity,transform] duration-500 ease-[var(--ease-flow)] ${
              after ? "-translate-y-2 opacity-0" : "translate-y-0 opacity-100"
            }`}
            style={{ transitionDelay: delay }}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cream/[0.05] text-sand ring-1 ring-cream/10">
              <FrictionGlyph />
            </span>
            <p className="text-[12.5px] leading-snug text-sand sm:text-[13px]">{row.before}</p>
          </div>

          <div
            aria-hidden={!after}
            className={`col-start-1 row-start-1 flex items-center gap-3 px-3.5 py-3 transition-[opacity,transform] duration-500 ease-[var(--ease-flow)] ${
              after ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
            }`}
            style={{ transitionDelay: delay }}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-terra text-cream shadow-[0_0_0_4px_rgba(198,93,59,0.18)]">
              <Icon.check size={12} />
            </span>
            <p className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug text-cream sm:text-[13px]">
              {row.after}
            </p>
            <Pill tone="terra" className="hidden shrink-0 sm:inline-flex">
              <Icon.bolt size={10} /> automated
            </Pill>
          </div>
        </div>
      </div>
    </li>
  );
}

/* ───────────── Section ───────────── */
export default function BeforeAfter() {
  const [mode, setMode] = useState<Mode>("before");
  const panel = useRef<HTMLDivElement>(null);
  const interacted = useRef(false);
  const labelId = useId();

  const choose = useCallback((m: Mode) => {
    interacted.current = true;
    setMode(m);
  }, []);

  // Auto-demo: the first time the panel scrolls into view, flip to "after"
  // after a beat — unless the visitor has already touched the control.
  useEffect(() => {
    if (!panel.current) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const st = ScrollTrigger.create({
      trigger: panel.current,
      start: "top 70%",
      once: true,
      onEnter: () => {
        timer = setTimeout(() => {
          if (!interacted.current) setMode("after");
        }, 1200);
      },
    });
    return () => {
      if (timer) clearTimeout(timer);
      st.kill();
    };
  }, []);

  const after = mode === "after";

  return (
    <section id="shift" className="relative scroll-mt-20 py-20 sm:py-28">
      {/* Ambient */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="glow-cream absolute -left-40 top-1/3 h-[40vh] w-[40vh] opacity-25" />
        <div className="glow-terra absolute -right-32 bottom-0 h-[45vh] w-[45vh] opacity-30" />
      </div>

      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <ScrollReveal className="max-w-3xl">
          <p className="eyebrow">From manual friction to managed flow</p>
          <h2 className="font-display mt-4 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl lg:text-6xl">
            Same business. <span className="text-gradient">Different operating system.</span>
          </h2>
          <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-cream-2 sm:text-lg">
            Nothing about your offer changes. What changes is how each routine step gets done — by
            rules, promises and a shared record instead of memory and messages.
          </p>
        </ScrollReveal>

        <ScrollReveal y={56} className="mt-12 sm:mt-16">
          <div className="grid gap-5 lg:grid-cols-[1fr_300px] lg:gap-6 xl:grid-cols-[1fr_320px]">
            {/* Main panel */}
            <div ref={panel} className="glass relative overflow-hidden rounded-3xl p-5 sm:p-7">
              <div
                className={`glow-terra pointer-events-none absolute -right-24 -top-24 h-72 w-72 transition-opacity duration-700 ${
                  after ? "opacity-50" : "opacity-0"
                }`}
              />

              <div className="relative flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p id={labelId} className="font-display text-base font-medium text-cream sm:text-lg">
                    Five operating areas. One switch.
                  </p>
                  <p className="mt-1 text-[12.5px] text-sand">
                    <span className="text-cream-2">Toggle the control</span> to see how the same
                    step behaves under Flow State.
                  </p>
                </div>
                <Segmented mode={mode} onChange={choose} labelId={labelId} />
              </div>

              <ul className="relative mt-6">
                {ROWS.map((row, i) => (
                  <ShiftRow key={row.area} row={row} mode={mode} index={i} />
                ))}
              </ul>

              <div className="relative mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-cream/[0.07] pt-4">
                <p className="text-[11.5px] text-sand">
                  {after ? (
                    <>
                      <span className="text-cream-2">Routine steps run automatically.</span> Approvals
                      and exceptions stay human-owned.
                    </>
                  ) : (
                    <>
                      <span className="text-cream-2">Every step depends on someone remembering.</span>{" "}
                      Volume grows; attention doesn&apos;t.
                    </>
                  )}
                </p>
                <span
                  className={`inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] transition-colors duration-500 ${
                    after ? "text-terra-bright" : "text-sand"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full transition-colors duration-500 ${
                      after ? "pulse-dot bg-terra-bright" : "bg-sand/60"
                    }`}
                  />
                  {after ? "5 of 5 automated" : "0 of 5 automated"}
                </span>
              </div>
            </div>

            {/* Impact column */}
            <aside className="glass rounded-3xl p-5 sm:p-6">
              <p className="eyebrow eyebrow--muted text-[10px]">Where the impact lands</p>
              <ul className="mt-4 divide-y divide-cream/[0.07]">
                {IMPACT.map((it, i) => (
                  <li key={it.label} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-[10px] text-terra-bright tabular-nums">0{i + 1}</span>
                      <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-cream-2">
                        {it.label}
                      </p>
                    </div>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-sand">{it.text}</p>
                  </li>
                ))}
              </ul>
              <a
                href="#impact"
                className="mt-5 inline-flex items-center gap-1.5 text-[12px] font-medium text-terra-bright transition-colors hover:text-cream"
              >
                Put your own numbers on it <Icon.arrow size={13} />
              </a>
            </aside>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
