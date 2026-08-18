import Link from "next/link";
import FlowOS from "@/components/os/FlowOS";
import ScrollReveal from "@/components/ScrollReveal";

export default function SystemSection() {
  return (
    <section id="system" className="relative scroll-mt-20 py-20 sm:py-28">
      {/* Ambient */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="glow-terra absolute left-1/2 top-24 h-[50vh] w-[80vw] -translate-x-1/2 opacity-30" />
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <ScrollReveal className="mx-auto max-w-3xl text-center">
          <p className="eyebrow">Live system · Interactive</p>
          <h2 className="font-display mt-4 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl lg:text-6xl">
            This isn&apos;t a screenshot. <span className="text-gradient">Touch it.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-relaxed text-cream-2 sm:text-lg">
            Drag a lead, answer an inquiry, fire an automation, ask the business a question.
            Every module below is a working slice of the system we design for you — customised
            business by business.
          </p>
        </ScrollReveal>

        <ScrollReveal y={60} className="mt-12 sm:mt-16">
          <FlowOS />
        </ScrollReveal>

        <ScrollReveal className="mx-auto mt-8 flex max-w-5xl flex-col items-center gap-6 lg:flex-row lg:justify-between">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Capture", "Respond & qualify"],
              ["Convert", "Score & advance"],
              ["Deliver", "Launch & update"],
              ["Collect", "Invoice & collect"],
            ].map(([a, b], i) => (
              <div key={a} className="flex items-center gap-3 text-[12.5px]">
                <span className="font-mono text-[10px] text-terra-bright">0{i + 1}</span>
                <span className="text-cream">{a}</span>
                <span className="hidden text-sand sm:inline">· {b}</span>
              </div>
            ))}
          </div>
          <Link
            href="/solution"
            className="group inline-flex items-center gap-2 text-[13px] text-cream-2 transition-colors hover:text-cream"
          >
            See the whole system, end to end
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
