import type { ReactNode } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/sections/Footer";
import { SITE } from "@/lib/site";

export type LegalSection = { heading: string; body: ReactNode };

/**
 * Shared shell for the legal routes. Same type scale and glass vocabulary as
 * the rest of the site, but a single readable column — these pages are for
 * reading, not for selling.
 */
export default function LegalPage({
  eyebrow,
  title,
  updated,
  intro,
  sections,
}: {
  eyebrow: string;
  title: string;
  /** Human-readable date, e.g. "17 August 2026". */
  updated: string;
  intro: ReactNode;
  sections: LegalSection[];
}) {
  return (
    <main className="relative overflow-x-clip">
      <Nav />

      <article className="relative pb-8 pt-[calc(var(--nav-h)+4rem)] sm:pt-[calc(var(--nav-h)+6rem)]">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="glow-terra absolute -right-40 top-0 h-[45vh] w-[45vh] opacity-20" />
        </div>

        <div className="mx-auto max-w-3xl px-6 sm:px-8">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="font-display mt-4 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl">
            {title}
          </h1>
          <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.18em] text-sand">
            Last updated {updated}
          </p>
          <div className="mt-7 text-pretty text-base leading-relaxed text-cream-2">{intro}</div>

          {/* Contents */}
          <nav aria-label="On this page" className="glass mt-10 rounded-2xl p-5 sm:p-6">
            <p className="text-[10px] uppercase tracking-[0.18em] text-sand">Contents</p>
            <ol className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {sections.map((s, i) => (
                <li key={s.heading} className="flex items-baseline gap-3">
                  <span className="font-mono text-[10px] text-terra-bright tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <a
                    href={`#s${i + 1}`}
                    className="text-[13.5px] text-cream-2 transition-colors hover:text-cream"
                  >
                    {s.heading}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {/* Body */}
          <div className="mt-12 space-y-10">
            {sections.map((s, i) => (
              <section key={s.heading} id={`s${i + 1}`} className="scroll-mt-28">
                <h2 className="font-display flex items-baseline gap-3 text-xl font-medium text-cream sm:text-2xl">
                  <span className="font-mono text-[11px] text-terra-bright tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {s.heading}
                </h2>
                <div className="mt-3 space-y-3 text-[14.5px] leading-relaxed text-cream-2 [&_a]:text-terra-bright [&_a:hover]:text-cream [&_li]:mt-1.5 [&_strong]:text-cream [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
                  {s.body}
                </div>
              </section>
            ))}
          </div>

          {/* Contact */}
          <div className="glass mt-14 rounded-2xl p-6 sm:p-7">
            <p className="text-[10px] uppercase tracking-[0.18em] text-sand">Questions about this page</p>
            <p className="mt-3 text-[14.5px] leading-relaxed text-cream-2">
              Write to{" "}
              <a
                href={`mailto:${SITE.email}`}
                className="font-medium text-terra-bright transition-colors hover:text-cream"
              >
                {SITE.email}
              </a>{" "}
              and we&apos;ll answer within one working day.
            </p>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-cream/10 pt-4 text-[13px]">
              <Link href="/privacy" className="text-cream-2 transition-colors hover:text-cream">
                Privacy Policy
              </Link>
              <Link href="/terms" className="text-cream-2 transition-colors hover:text-cream">
                Terms of Service
              </Link>
              <Link href="/contact" className="text-cream-2 transition-colors hover:text-cream">
                Contact us
              </Link>
            </div>
          </div>
        </div>
      </article>

      <Footer />
    </main>
  );
}
