import Link from "next/link";
import ScrollReveal from "@/components/ScrollReveal";
import StackContrast from "./StackContrast";

type Reason = { n: string; title: string; body: string };

const REASONS: Reason[] = [
  { n: "01", title: "Designed around your business", body: "Your pipeline, your languages, your approvals." },
  { n: "02", title: "One layer, not another tool", body: "One record, one engine. Nothing re-typed." },
  { n: "03", title: "Routine runs itself", body: "Decisions and exceptions still come to a person." },
  { n: "04", title: "You see it before you commit", body: "The live system is on this page. Touch it." },
  { n: "05", title: "Built for business here", body: "Three languages, WhatsApp-first, rupees and cheques." },
  { n: "06", title: "Measured in hours and cash", body: "Every action logs the minutes it saves." },
];

export default function WhyUs() {
  return (
    <section id="why" className="relative scroll-mt-20 py-20 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="glow-terra absolute -left-40 top-1/3 h-[50vh] w-[50vh] opacity-20" />
      </div>

      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <ScrollReveal className="max-w-3xl">
          <p className="eyebrow">Why Flow State</p>
          <h2 className="font-display mt-4 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl lg:text-6xl">
            Not another tool. <span className="text-gradient">A system that fits.</span>
          </h2>
          <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-cream-2 sm:text-lg">
            Six reasons owners choose a built system over a subscription.
          </p>
        </ScrollReveal>

        <ScrollReveal y={48} className="mt-12 sm:mt-14">
          <StackContrast />
        </ScrollReveal>

        <ScrollReveal
          as="ol"
          stagger="[data-reason]"
          y={28}
          className="mt-12 grid grid-cols-1 gap-4 sm:mt-14 md:grid-cols-2 lg:grid-cols-3 lg:gap-5"
        >
          {REASONS.map((r) => (
            <li
              key={r.n}
              data-reason
              className="group glass rounded-2xl p-5 transition-[transform,border-color,box-shadow] duration-500 ease-[var(--ease-flow)] hover:-translate-y-1 hover:border-cream/25 hover:shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85),0_0_0_1px_rgba(198,93,59,0.15)] sm:p-6"
            >
              <span className="font-mono text-[10.5px] tracking-[0.2em] text-terra-bright tabular-nums">{r.n}</span>
              <h3 className="font-display mt-3 text-lg font-medium leading-snug text-cream">{r.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-sand">{r.body}</p>
            </li>
          ))}
        </ScrollReveal>

        <ScrollReveal className="mt-8 flex flex-col gap-3 border-t border-cream/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] text-sand">
            Every rule is written in plain business terms — and stays visible in the activity feed.
          </p>
          <Link
            href="/solution"
            className="group inline-flex min-h-[40px] items-center gap-2 py-1.5 text-[13px] text-cream-2 transition-colors hover:text-cream"
          >
            See how it fits together
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
        </ScrollReveal>
      </div>
    </section>
  );
}
