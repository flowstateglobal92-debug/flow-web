import Image from "next/image";
import Link from "next/link";
import FooterBackdrop from "@/components/sections/FooterBackdrop";
import { SITE } from "@/lib/site";

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Solution",
    links: [
      { label: "Live system", href: "/#system" },
      { label: "Operating flow", href: "/solution#cycle" },
      { label: "Capabilities", href: "/solution#capabilities" },
      { label: "Playbooks", href: "/solution#playbooks" },
      { label: "Impact", href: "/solution#impact" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Why Flow State", href: "/#why" },
      { label: "Our process", href: "/#process" },
      { label: "Contact us", href: "/contact" },
    ],
  },
];

const LEGAL = [
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms of Service", href: "/terms" },
];

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative isolate mt-6 overflow-hidden sm:mt-10">
      <div className="hairline" />
      <FooterBackdrop />

      <div className="relative mx-auto max-w-7xl px-6 pb-10 pt-14 sm:px-8 sm:pt-16">
        {/* Top row */}
        <div className="grid gap-12 lg:grid-cols-[1.5fr_1fr_1fr_1.2fr] lg:gap-8">
          {/* Brand */}
          <div>
            <Link href="/" className="inline-flex items-center gap-3" aria-label={`${SITE.name} — home`}>
              <Image
                src="/brand/mark-256.webp"
                alt=""
                width={250}
                height={256}
                sizes="32px"
                className="h-8 w-8 object-contain"
              />
              <Image
                src="/brand/wordmark.webp"
                alt={SITE.name}
                width={400}
                height={71}
                sizes="90px"
                className="h-auto w-[90px] opacity-90"
              />
            </Link>
            <p className="mt-5 max-w-xs text-[13.5px] leading-relaxed text-cream-2">
              AI systems and automation, designed business by business.
            </p>

            <address className="mt-6 space-y-2 not-italic">
              <a
                href={`mailto:${SITE.email}`}
                className="group inline-flex items-center gap-2.5 text-[13.5px] text-cream-2 transition-colors hover:text-cream"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-sand transition-colors group-hover:text-terra-bright">
                  <rect x="3.5" y="5.5" width="17" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
                  <path d="m4.5 7 7.5 6 7.5-6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
                {SITE.email}
              </a>
              <p className="flex items-center gap-2.5 text-[13.5px] text-cream-2">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-sand">
                  <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6" />
                </svg>
                {SITE.region}
              </p>
            </address>

            <p className="mt-5 flex items-center gap-2.5 font-mono text-[11px] tracking-[0.06em] text-sand">
              <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-terra-bright" />
              Office hours: Mon–Sat
            </p>
          </div>

          {/* Link columns */}
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="text-[10px] uppercase tracking-[0.18em] text-sand">{col.title}</p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="group inline-flex items-center gap-2 text-[13.5px] text-cream-2 transition-colors hover:text-cream"
                    >
                      <span className="h-px w-0 bg-terra-bright transition-all duration-300 ease-[var(--ease-flow)] group-hover:w-3" />
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          {/* Note */}
          <div className="lg:justify-self-end lg:max-w-[240px]">
            <p className="text-[10px] uppercase tracking-[0.18em] text-sand">Walkthrough</p>
            <p className="mt-4 text-[13px] leading-relaxed text-cream-2">
              30 minutes. No obligation. You keep the automation map.
            </p>
            <Link href="/contact" className="btn btn--ghost btn--sm mt-4">
              Book a walkthrough
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
        </div>

        <p className="mt-12 max-w-2xl font-mono text-[10.5px] leading-relaxed tracking-[0.04em] text-sand/70">
          Feature availability and workflow behaviour depend on configuration and connected services.
        </p>

        {/* Bottom row */}
        <div className="mt-6 flex flex-col gap-4 border-t border-cream/[0.07] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] text-sand">
            © {year} {SITE.name}. All rights reserved.
          </p>
          <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {LEGAL.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-[12px] text-sand transition-colors hover:text-cream"
              >
                {l.label}
              </Link>
            ))}
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-sand/70">
              <span className="h-1 w-1 rounded-full bg-terra" />
              Made to run in flow.
            </span>
          </nav>
        </div>
      </div>
    </footer>
  );
}
