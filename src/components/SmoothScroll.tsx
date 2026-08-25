"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type Lenis from "lenis";
import { gsap, ScrollTrigger } from "@/lib/gsap";
// Root-layout import: evaluating this module on every document load is what
// lets the preloader tell a real entry on "/" from a client-side navigation.
import "@/lib/entry";

/** Nav overlap an anchor target has to clear. */
const ANCHOR_OFFSET = 72;

/**
 * Lenis smooth scroll driven by GSAP's ticker so ScrollTrigger and the
 * scroll position always agree on the same frame.
 *
 * Touch pointers are excluded on purpose. Lenis leaves touch scrolling to the
 * browser (`syncTouch` is off), so on a phone it smooths nothing while still
 * costing a permanent rAF ticker, a `ScrollTrigger.update` on every scroll
 * emission, and an `overscroll-behavior: contain` on every
 * `[data-lenis-prevent]` pane — the last of which is what stopped a swipe
 * inside the OS demo from ever reaching the page. The import is dynamic so the
 * library never lands in the mobile bundle either.
 */
export default function SmoothScroll({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The admin is an app surface, not a scroll narrative — inertia there fights
    // the boards, tables and dialogs.
    const isAdmin = pathname.startsWith("/admin");
    const coarse = window.matchMedia("(pointer: coarse)").matches;

    let lenis: Lenis | null = null;
    let disposed = false;
    let releaseTicker: (() => void) | undefined;

    if (!reduced && !isAdmin && !coarse) {
      void import("lenis").then(({ default: LenisCtor }) => {
        if (disposed) return;
        const l = new LenisCtor({ lerp: 0.09, wheelMultiplier: 0.95, smoothWheel: true });
        lenis = l;

        l.on("scroll", ScrollTrigger.update);
        const tick = (time: number) => l.raf(time * 1000);
        gsap.ticker.add(tick);
        // Lenis owns the frame clock while it runs, so catching up beats skipping.
        gsap.ticker.lagSmoothing(0);
        releaseTicker = () => {
          gsap.ticker.remove(tick);
          gsap.ticker.lagSmoothing(500, 33); // GSAP's own defaults
        };
      });
    }

    // Anchor links should glide, not jump — with or without Lenis.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href^='#']");
      if (!a) return;
      const id = a.getAttribute("href");
      if (!id || id === "#") return;
      const el = document.querySelector<HTMLElement>(id);
      if (!el) return;
      e.preventDefault();
      if (lenis) {
        lenis.scrollTo(el, { offset: -ANCHOR_OFFSET, duration: 1.4 });
        return;
      }
      window.scrollTo({
        top: el.getBoundingClientRect().top + window.scrollY - ANCHOR_OFFSET,
        behavior: reduced ? "auto" : "smooth",
      });
    };
    document.addEventListener("click", onClick);

    return () => {
      disposed = true;
      document.removeEventListener("click", onClick);
      releaseTicker?.();
      lenis?.destroy();
    };
  }, [pathname]);

  return <>{children}</>;
}
