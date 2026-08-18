import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/sections/Footer";

export const metadata: Metadata = {
  title: "Page not found",
  description: "That page doesn't exist. Head back to the live system, our solution, or get in touch.",
  robots: { index: false, follow: true },
};

const LINKS = [
  { href: "/", label: "Home", hint: "The company and the live system" },
  { href: "/solution", label: "Our solution", hint: "Capabilities, playbooks and impact" },
  { href: "/about", label: "About", hint: "Who we are and how we work" },
  { href: "/contact", label: "Contact us", hint: "Book a 30-minute walkthrough" },
];

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-x-clip">
      <Nav />

      <section className="relative flex flex-1 items-center pb-20 pt-[calc(var(--nav-h)+5rem)]">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="glow-terra absolute left-1/2 top-1/3 h-[50vh] w-[70vw] -translate-x-1/2 opacity-25" />
          <div className="grid-lines absolute inset-0 opacity-40" />
        </div>

        <div className="mx-auto grid grid-cols-1 w-full max-w-7xl items-center gap-12 px-6 sm:px-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
          <div>
            <p className="eyebrow">Error 404</p>
            <h1 className="font-display mt-4 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl lg:text-6xl">
              This page never <span className="text-gradient">made it into flow.</span>
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-cream-2 sm:text-lg">
              The link is broken or the page has moved. Everything else is still running — pick a
              direction below.
            </p>

            <ul className="mt-10 divide-y divide-cream/10 border-y border-cream/10">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="group flex items-center gap-4 py-4">
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-terra-bright">→</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium text-cream">{l.label}</span>
                      <span className="block text-[12.5px] text-sand">{l.hint}</span>
                    </span>
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                      className="shrink-0 text-sand transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-cream"
                    >
                      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative hidden lg:block">
            <div className="glow-terra absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 opacity-45" />
            <Image
              src="/art/logo-object.webp"
              alt=""
              width={1000}
              height={1000}
              sizes="320px"
              className="float-y relative mx-auto h-auto w-[320px] drop-shadow-[0_24px_48px_rgba(0,0,0,0.6)]"
            />
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
