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

        <ScrollReveal className="mx-auto mt-8 max-w-5xl">
          <div className="glass flex flex-col items-center justify-between gap-4 rounded-2xl border border-cream/10 p-4 sm:flex-row sm:rounded-full sm:px-6 sm:py-3">
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-4 md:gap-6">
              {[
                ["Capture", "Respond & qualify"],
                ["Convert", "Score & advance"],
                ["Deliver", "Launch & update"],
                ["Collect", "Invoice & collect"],
              ].map(([a, b], i) => (
                <div
                  key={a}
                  className="flex items-center justify-center gap-2 rounded-lg border border-cream/[0.06] bg-cream/[0.03] px-3 py-2 text-[12.5px] sm:border-0 sm:bg-transparent sm:p-0 sm:justify-start"
                >
                  <span className="font-mono text-[10.5px] font-medium text-terra-bright">0{i + 1}</span>
                  <span className="font-medium text-cream">{a}</span>
                  <span className="hidden text-sand lg:inline">· {b}</span>
                </div>
              ))}
            </div>

            <Link
              href="/solution"
              className="group inline-flex min-h-[38px] w-full items-center justify-center gap-2 rounded-xl bg-cream/[0.04] px-4 py-2 text-[12.5px] font-medium text-cream-2 transition-all hover:bg-cream/[0.08] hover:text-cream sm:w-auto sm:rounded-none sm:bg-transparent sm:p-0 sm:hover:bg-transparent"
            >
              <span>See the whole system, end to end</span>
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
      </div>
    </section>
  );
}
