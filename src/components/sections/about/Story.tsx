import Image from "next/image";
import ScrollReveal from "@/components/ScrollReveal";

/**
 * Why the company exists. The two interlocking loops of the mark carry the
 * story: the business and the system, linked so that neither runs alone.
 */
export default function Story() {
  return (
    <section id="story" className="relative scroll-mt-20 py-20 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="glow-terra absolute -right-40 top-1/3 h-[55vh] w-[55vh] opacity-25" />
      </div>

      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
          <ScrollReveal>
            <p className="eyebrow">Why we exist</p>
            <h2 className="font-display mt-4 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl lg:text-6xl">
              Most growing businesses don&apos;t have a technology problem.{" "}
              <span className="text-gradient">They have a follow-through problem.</span>
            </h2>
            <div className="mt-7 max-w-2xl space-y-5 text-justify text-base leading-relaxed text-cream-2 [text-align-last:left] hyphens-auto sm:text-lg">
              <p>
                The enquiry came in at 9pm and got answered at 11am. The follow-up was promised for Tuesday
                and remembered on Friday. The proposal was sent and never seen again. The invoice went out
                late because the person who sends invoices was on site. None of this is a lack of effort.
                It&apos;s what happens when a business grows past the point where memory and messages can
                hold it together.
              </p>
              <p>
                Flow State began as an answer to that specific moment. Not another app to log into, and not
                a consultant&apos;s slide deck — a working system, designed around how each business
                actually operates, that takes the routine steps off people&apos;s plates and puts the
                whole operation in one place they can see.
              </p>
              <p>
                We build the operating layer we wished our own clients had: one shared customer record, one
                automation engine, one command surface — and a rollout that starts with the work that hurts
                most.
              </p>
            </div>

            <dl className="mt-9 grid grid-cols-2 gap-6 border-t border-cream/10 pt-6 sm:grid-cols-4">
              {[
                ["9", "capabilities, one record"],
                ["6", "standard playbooks"],
                ["4", "steps to roll out"],
                ["3", "languages, day one"],
              ].map(([big, small]) => (
                <div key={small}>
                  <dt className="sr-only">{small}</dt>
                  <dd className="font-display text-3xl text-cream">{big}</dd>
                  <dd className="mt-1 text-[10px] uppercase tracking-[0.16em] text-sand">{small}</dd>
                </div>
              ))}
            </dl>
          </ScrollReveal>

          <ScrollReveal y={48} className="relative">
            <div className="glass relative overflow-hidden rounded-3xl p-8 sm:p-10">
              <div className="glow-terra pointer-events-none absolute left-1/2 top-1/2 h-[80%] w-[80%] -translate-x-1/2 -translate-y-1/2 opacity-50" />
              <Image
                src="/art/logo-object.webp"
                alt="Two interlocking glass loops — one terracotta, one cream — the Flow State mark as an object."
                width={1000}
                height={1000}
                sizes="(min-width: 1024px) 40vw, 80vw"
                className="float-y relative mx-auto h-auto w-[78%] drop-shadow-[0_24px_48px_rgba(0,0,0,0.6)]"
              />
              <div className="relative mt-6 border-t border-cream/10 pt-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-sand">The mark</p>
                <p className="mt-2 text-[13.5px] leading-relaxed text-cream-2">
                  Two loops, linked. <span className="text-cream">Your business and its system</span> — neither
                  runs alone, and nothing falls between them.
                </p>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}
