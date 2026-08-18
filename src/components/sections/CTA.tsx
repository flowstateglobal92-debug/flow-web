import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import ScrollReveal from "@/components/ScrollReveal";

type Props = {
  eyebrow?: ReactNode;
  title?: ReactNode;
  copy?: ReactNode;
  /** Secondary button. Defaults to the solution page. */
  secondary?: { label: string; href: string };
};

const STEPS = [
  ["01", "We confirm a slot", "WhatsApp or email, within one working day."],
  ["02", "30-minute mapping call", "Your workflows, your volumes, your tools."],
  ["03", "You keep the map", "Three automations, sequenced and scoped."],
] as const;

/**
 * Closing call-to-action band. Points to the contact page (where the form
 * lives) instead of embedding a form on every page.
 */
export default function CTA({
  eyebrow = "Book a walkthrough",
  title = (
    <>
      Map the first <span className="text-gradient">three automations.</span>
    </>
  ),
  copy = "Choose the workflows that consume the most time or lose the most opportunity. We turn them into one connected operating flow — designed for your business, not a template.",
  secondary = { label: "See our solution", href: "/solution" },
}: Props) {
  return (
    <section id="cta" className="relative scroll-mt-20 py-20 sm:py-28">
      {/* Ambient */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="glow-terra absolute left-1/2 top-1/2 h-[60vh] w-[90vw] -translate-x-1/2 -translate-y-1/2 opacity-30" />
      </div>

      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <ScrollReveal y={50}>
          <div className="glass glass--strong relative overflow-hidden rounded-[32px]">
            {/* Background bloom */}
            <div className="pointer-events-none absolute inset-0" aria-hidden>
              <div className="absolute inset-y-0 left-0 w-full lg:left-[18%] lg:w-[100%]">
                <Image
                  src="/art/cta-bloom.webp"
                  alt=""
                  fill
                  sizes="(min-width: 1280px) 1216px, 100vw"
                  className="object-cover object-right opacity-60 lg:opacity-90"
                />
              </div>
              <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/10" />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-transparent to-ink/20 lg:from-ink/40 lg:to-transparent" />
            </div>

            <div className="relative grid gap-10 p-7 sm:p-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:p-14 xl:p-16">
              {/* Copy */}
              <div className="max-w-xl">
                <p className="eyebrow flex items-center gap-3">
                  <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-terra-bright" />
                  {eyebrow}
                </p>
                <h2 className="font-display mt-5 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl lg:text-6xl">
                  {title}
                </h2>
                <p className="mt-6 text-pretty text-base leading-relaxed text-cream-2 sm:text-lg">{copy}</p>

                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Link href="/contact" className="btn btn--anim btn--primary px-7 py-4">
                    <span className="btn__label">Book a walkthrough</span>
                    <svg className="btn__arrow" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                  <Link href={secondary.href} className="btn btn--anim btn--ghost px-7 py-4">
                    <span className="btn__label">{secondary.label}</span>
                    <svg className="btn__arrow" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                </div>

                <ul className="mt-8 hidden gap-x-8 gap-y-4 sm:grid sm:grid-cols-3 lg:max-w-md">
                  {[
                    ["30 min", "focused call"],
                    ["3", "automations mapped"],
                    ["1 day", "reply time"],
                  ].map(([big, small]) => (
                    <li key={small}>
                      <p className="font-display text-xl text-cream">{big}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-sand">{small}</p>
                    </li>
                  ))}
                </ul>
              </div>

              {/* What happens next */}
              <div className="lg:w-full lg:max-w-md lg:justify-self-end">
                <div className="glass-inset rounded-2xl p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] sm:p-6">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-sand">What happens next</p>
                  <ol className="mt-4 divide-y divide-cream/[0.07]">
                    {STEPS.map(([n, t, d]) => (
                      <li key={n} className="flex items-start gap-3.5 py-3.5 first:pt-0 last:pb-0">
                        <span className="mt-0.5 font-mono text-[10px] text-terra-bright">{n}</span>
                        <div>
                          <p className="text-[13.5px] font-medium text-cream">{t}</p>
                          <p className="mt-0.5 text-[12px] leading-relaxed text-sand">{d}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-5 flex items-center justify-between gap-3 border-t border-cream/[0.07] pt-4">
                    <p className="text-[11.5px] text-sand">
                      Prefer to talk first? <span className="text-cream-2">WhatsApp us any time.</span>
                    </p>
                    <a
                      href="#"
                      className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-terra-bright transition-colors hover:text-cream"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M4 20l1.3-4A8.5 8.5 0 1 1 8.5 19z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                        <path d="M9.5 9.5c0 3 2 5 5 5l1-1.5-2-1-1 .8a3.5 3.5 0 0 1-1.6-1.6l.8-1-1-2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                      </svg>
                      WhatsApp
                    </a>
                  </div>
                </div>

                <p className="mt-4 text-center font-mono text-[10.5px] tracking-[0.06em] text-sand lg:text-left">
                  No obligation <span className="mx-1.5 text-cream/25">·</span> 30-minute call{" "}
                  <span className="mx-1.5 text-cream/25">·</span> You keep the automation map.
                </p>
              </div>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
