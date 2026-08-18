"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/solution", label: "Our solution" },
  { href: "/contact", label: "Contact" },
] as const;

export default function Nav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile sheet whenever the route changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- route change is an external event
    setOpen(false);
  }, [pathname]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4">
      <nav
        className={`glass glass--blur flex w-full max-w-6xl items-center justify-between rounded-none py-2 pl-3 pr-2 transition-all duration-300 ${
          scrolled ? "glass--strong" : ""
        }`}
        aria-label="Primary"
      >
        <Link href="/" className="group flex items-center gap-3 pl-1" aria-label="Flow State — home">
          <span data-nav-mark className="relative block h-11 w-11 transition-opacity duration-500">
            <span className="absolute inset-0 rounded-full bg-terra/40 blur-lg opacity-0 transition-opacity group-hover:opacity-100" />
            <Image
              src="/brand/mark.png"
              alt="Flow State"
              width={598}
              height={612}
              priority
              sizes="44px"
              className="relative h-11 w-auto object-contain"
            />
          </span>
          <Image
            src="/brand/wordmark.png"
            alt=""
            width={863}
            height={153}
            priority
            sizes="150px"
            className="hidden h-[20px] w-auto opacity-90 sm:block"
          />
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => {
            const active = isActive(l.href);
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex items-center gap-2 rounded-none px-4 py-2 font-display text-[13.5px] tracking-[0.02em] transition-colors ${
                    active ? "text-cream" : "text-cream-2 hover:text-cream"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-1 w-1 rounded-full bg-terra-bright transition-all duration-300 ${
                      active ? "opacity-100" : "scale-0 opacity-0 group-hover:scale-100 group-hover:opacity-60"
                    }`}
                  />
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-2">
          <Link href="/contact" className="btn btn--primary btn--sm hidden sm:inline-flex">
            Book a walkthrough
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="btn btn--ghost btn--sm h-10 w-10 !p-0 md:hidden"
          >
            <span className="relative block h-3 w-4">
              <span className={`absolute left-0 top-0 h-px w-full bg-cream transition-transform ${open ? "translate-y-[6px] rotate-45" : ""}`} />
              <span className={`absolute left-0 top-[6px] h-px w-full bg-cream transition-opacity ${open ? "opacity-0" : ""}`} />
              <span className={`absolute left-0 top-3 h-px w-full bg-cream transition-transform ${open ? "-translate-y-[6px] -rotate-45" : ""}`} />
            </span>
          </button>
        </div>
      </nav>

      {/* Mobile sheet */}
      <div
        className={`glass glass--blur glass--strong absolute left-4 right-4 top-[calc(100%+8px)] origin-top rounded-none p-3 transition-all duration-300 md:hidden ${
          open ? "visible pointer-events-auto scale-100 opacity-100" : "invisible pointer-events-none scale-95 opacity-0"
        }`}
      >
        {LINKS.map((l) => {
          const active = isActive(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-none px-4 py-3 font-display text-base tracking-[0.02em] transition-colors hover:bg-cream/5 hover:text-cream ${
                active ? "text-cream" : "text-cream-2"
              }`}
            >
              <span
                aria-hidden
                className={`h-1 w-1 rounded-full bg-terra-bright ${active ? "opacity-100" : "opacity-0"}`}
              />
              {l.label}
            </Link>
          );
        })}
        <Link href="/contact" onClick={() => setOpen(false)} className="btn btn--primary mt-2 w-full">
          Book a walkthrough
        </Link>
      </div>
    </header>
  );
}
