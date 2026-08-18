"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import ScrollReveal from "@/components/ScrollReveal";

export type FaqItem = { q: string; a: ReactNode };

type Props = {
  id?: string;
  eyebrow?: ReactNode;
  title?: ReactNode;
  sub?: ReactNode;
  items: FaqItem[];
  /** Index opened by default (−1 for none). */
  defaultOpen?: number;
  /** The "still have a question" link under the heading. */
  cta?: { label: string; href: string; note?: string };
};

function Item({
  item,
  index,
  open,
  onToggle,
  uid,
}: {
  item: FaqItem;
  index: number;
  open: boolean;
  onToggle: () => void;
  uid: string;
}) {
  const btnId = `${uid}-q${index}`;
  const panelId = `${uid}-a${index}`;
  return (
    <li className="border-t border-cream/[0.08] first:border-t-0">
      <h3>
        <button
          type="button"
          id={btnId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="group flex w-full items-start gap-4 py-5 text-left sm:gap-6"
        >
          <span className="mt-1 font-mono text-[10px] text-terra-bright tabular-nums">0{index + 1}</span>
          <span
            className={`flex-1 font-display text-[17px] font-medium leading-snug transition-colors duration-300 sm:text-lg ${
              open ? "text-cream" : "text-cream-2 group-hover:text-cream"
            }`}
          >
            {item.q}
          </span>
          <span
            aria-hidden
            className={`relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 transition-all duration-500 ease-[var(--ease-flow)] ${
              open ? "bg-terra/20 text-terra-bright ring-terra/40" : "bg-cream/[0.04] text-sand ring-cream/12 group-hover:ring-cream/25"
            }`}
          >
            <span className="absolute h-px w-2.5 bg-current" />
            <span
              className={`absolute h-2.5 w-px bg-current transition-transform duration-500 ease-[var(--ease-flow)] ${
                open ? "rotate-90 scale-y-0" : ""
              }`}
            />
          </span>
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={btnId}
        className="grid grid-cols-1 transition-[grid-template-rows] duration-500 ease-[var(--ease-flow)]"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div
            className={`pb-6 pl-8 pr-10 text-[14px] leading-relaxed text-cream-2 transition-opacity duration-500 sm:pl-10 sm:text-[14.5px] ${
              open ? "opacity-100" : "opacity-0"
            }`}
          >
            {item.a}
          </div>
        </div>
      </div>
    </li>
  );
}

export default function FAQ({
  id = "faq",
  eyebrow = "Questions owners ask",
  title = (
    <>
      Straight answers, <span className="text-gradient">before the call.</span>
    </>
  ),
  sub = "The things people usually want to know before they book — answered the way we would answer them in the room.",
  items,
  defaultOpen = 0,
  cta = { label: "Ask us directly", href: "/contact", note: "Something else on your mind?" },
}: Props) {
  const [open, setOpen] = useState<number>(defaultOpen);
  const uid = useId();

  return (
    <section id={id} className="relative scroll-mt-20 py-20 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="glow-terra absolute -left-40 top-1/3 h-[45vh] w-[45vh] opacity-20" />
      </div>

      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <ScrollReveal className="lg:sticky lg:top-28 lg:self-start">
            <p className="eyebrow">{eyebrow}</p>
            <h2 className="font-display mt-4 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl">
              {title}
            </h2>
            <p className="mt-5 max-w-md text-pretty text-base leading-relaxed text-cream-2 sm:text-lg">{sub}</p>
            <div className="mt-8 flex flex-col gap-3 border-t border-cream/10 pt-6 sm:flex-row sm:items-center">
              {cta.note && <p className="text-[12.5px] text-sand">{cta.note}</p>}
              <Link
                href={cta.href}
                className="group inline-flex min-h-[40px] items-center gap-2 py-1.5 text-[13px] text-cream-2 transition-colors hover:text-cream"
              >
                {cta.label}
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                  className="transition-transform duration-300 group-hover:translate-x-0.5"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </div>
          </ScrollReveal>

          <ScrollReveal y={40}>
            <ul className="glass rounded-3xl px-5 sm:px-7">
              {items.map((item, i) => (
                <Item
                  key={item.q}
                  item={item}
                  index={i}
                  uid={uid}
                  open={open === i}
                  onToggle={() => setOpen((cur) => (cur === i ? -1 : i))}
                />
              ))}
            </ul>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}
