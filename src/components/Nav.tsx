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

  // The sheet overlays the page: freeze the page behind it so a swipe moves the
  // menu, not the content underneath. Lenis reads `lenis-stopped` off <html>.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    html.classList.add("lenis-stopped");
    html.style.overflow = "hidden";
    return () => {
      html.classList.remove("lenis-stopped");
      html.style.overflow = "";
    };
  }, [open]);

  // Escape closes it, like any other overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header
      className="fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3 sm:px-4 sm:pt-4"
      style={{ paddingLeft: "max(0.75rem, var(--safe-l))", paddingRight: "max(0.75rem, var(--safe-r))" }}
    >
      <nav
        className={`glass glass--blur flex w-full max-w-6xl items-center justify-between rounded-none py-1.5 pl-2.5 pr-1.5 transition-all duration-300 sm:py-2 sm:pl-3 sm:pr-2 ${
          scrolled ? "glass--strong" : ""
        }`}
        aria-label="Primary"
      >
        <Link href="/" className="group flex items-center gap-2.5 pl-1 sm:gap-3" aria-label="Flow State — home">
          <span data-nav-mark className="relative block h-9 w-9 transition-opacity duration-500 sm:h-11 sm:w-11">
            <span className="absolute inset-0 rounded-full bg-terra/40 blur-lg opacity-0 transition-opacity group-hover:opacity-100" />
            {/* WebP, not the 542KB PNG: same artwork at 35KB, and the same
                source the footer already uses. `loading="eager"` rather than
                `priority` — these fetch immediately but must not emit preload
                hints that race the hero art for the LCP. */}
            <Image
              src="/brand/mark-256.webp"
              alt="Flow State"
              width={250}
              height={256}
              loading="eager"
              sizes="(min-width: 640px) 44px, 36px"
              className="relative h-9 w-auto object-contain sm:h-11"
            />
          </span>
          <Image
            src="/brand/wordmark.webp"
            alt=""
            width={400}
            height={71}
            loading="eager"
            sizes="150px"
            className="hidden h-[20px] w-auto opacity-90 sm:block"
          />
        </Link>

        <ul className="hidden items-center gap-1 lg:flex">
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
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
            className="btn btn--ghost btn--sm h-10 w-10 !p-0 lg:hidden"
          >
            <span className="relative block h-3 w-4">
              <span className={`absolute left-0 top-0 h-px w-full bg-cream transition-transform ${open ? "translate-y-[6px] rotate-45" : ""}`} />
              <span className={`absolute left-0 top-[6px] h-px w-full bg-cream transition-opacity ${open ? "opacity-0" : ""}`} />
              <span className={`absolute left-0 top-3 h-px w-full bg-cream transition-transform ${open ? "-translate-y-[6px] -rotate-45" : ""}`} />
            </span>
          </button>
        </div>
      </nav>

      {/* Backdrop — tapping outside the sheet closes it. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={() => setOpen(false)}
        className={`fixed inset-0 -z-10 cursor-default bg-ink/40 transition-opacity duration-300 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Mobile sheet */}
      <div
        id="mobile-menu"
        className={`glass glass--blur glass--strong scroll-thin absolute left-3 right-3 top-[calc(100%+8px)] max-h-[calc(100svh-var(--nav-h)-1.5rem)] origin-top overflow-y-auto overscroll-contain rounded-none p-3 transition-all duration-300 sm:left-4 sm:right-4 lg:hidden ${
          open ? "visible pointer-events-auto scale-100 opacity-100" : "invisible pointer-events-none scale-95 opacity-0"
        }`}
        data-lenis-prevent
        data-modal
        aria-hidden={!open}
      >
        {LINKS.map((l) => {
          const active = isActive(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              aria-current={active ? "page" : undefined}
              tabIndex={open ? undefined : -1}
              className={`flex min-h-[48px] items-center gap-3 rounded-none px-4 py-3 font-display text-base tracking-[0.02em] transition-colors hover:bg-cream/5 hover:text-cream ${
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
        <Link
          href="/contact"
          onClick={() => setOpen(false)}
          tabIndex={open ? undefined : -1}
          className="btn btn--primary mt-2 w-full"
        >
          Book a walkthrough
        </Link>
      </div>
    </header>
  );
}
