"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { gsap, useGSAP, ScrollTrigger, EASE } from "@/lib/gsap";
import { onReveal } from "@/lib/reveal";
import LiquidWordmark from "./LiquidWordmark";
import CtaButton from "@/components/CtaButton";

const HeroBackdrop = dynamic(() => import("./HeroBackdrop"), {
  ssr: false,
  loading: () => null,
});

/** The four pains the system removes — the owner's problem, in their words. */
const PAINS = [
  ["Missed leads", "Enquiries after hours"],
  ["Cold deals", "Follow-up left to memory"],
  ["Lost hours", "Re-typing the same data"],
  ["Late cash", "Invoices chased by hand"],
];

export default function Hero() {
  const root = useRef<HTMLElement>(null);
  const scroll = useRef(0);
  const mouse = useRef({ x: 0.62, y: 0.55 });
  const [quality, setQuality] = useState(1);
  const [ready, setReady] = useState(false);
  const [motionOk, setMotionOk] = useState(true);
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const small = window.innerWidth < 768;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- device capability is only knowable on the client
    setQuality(coarse || small ? 0.4 : 1);
    setMotionOk(!reduced);
    // Defer the WebGL canvas one frame so the copy paints first.
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // The shader has nothing to say once the hero is scrolled past; stop its
  // render loop rather than burning a GPU frame for every frame of the page.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    mouse.current = {
      x: (e.clientX - r.left) / r.width,
      y: 1 - (e.clientY - r.top) / r.height, // GL space: y up
    };
  }, []);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        // Explicit line masks (the second line holds the liquid wordmark, so no SplitText).
        const masks = gsap.utils.toArray<HTMLElement>("[data-hero-line-mask]");
        const restore = () =>
          masks.forEach((m) => (m.style.overflow = "visible"));
        // Paused until the preloader lifts (or immediately if there is none).
        const tl = gsap.timeline({
          defaults: { ease: EASE.expo },
          onComplete: restore,
          paused: true,
        });
        const offReveal = onReveal(() => tl.play());
        tl.from(
          "[data-hero-line]",
          { yPercent: 110, duration: 1.3, stagger: 0.1 },
          0.15,
        )
          .from("[data-hero-sub]", { y: 22, opacity: 0, duration: 1 }, 0.55)
          .from(
            "[data-hero-cta] > *",
            { y: 18, opacity: 0, duration: 0.9, stagger: 0.08 },
            0.7,
          )
          .from(
            "[data-hero-proof] > *",
            { y: 12, opacity: 0, duration: 0.8, stagger: 0.06 },
            0.95,
          );

        // Scroll drives the backdrop (parallax + dim) and the copy parallax.
        ScrollTrigger.create({
          trigger: root.current,
          start: "top top",
          end: "bottom top",
          scrub: true,
          onUpdate: (self) => {
            scroll.current = self.progress;
          },
        });
        gsap.to("[data-hero-copy]", {
          yPercent: -16,
          opacity: 0.1,
          ease: "none",
          scrollTrigger: {
            trigger: root.current,
            start: "top top",
            end: "75% top",
            scrub: true,
          },
        });

        return () => {
          offReveal();
          restore();
        };
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section
      id="top"
      ref={root}
      onPointerMove={onPointerMove}
      className="relative isolate flex min-h-[100svh] flex-col justify-end overflow-hidden pb-8 pt-[calc(var(--nav-h)+1.5rem)] sm:pb-14 sm:pt-[calc(var(--nav-h)+2rem)]"
    >
      {/* Animated backdrop */}
      <div className="absolute inset-0 -z-20" aria-hidden>
        {/* Static image underneath: instant paint, and the fallback for reduced motion / no WebGL. */}
        <div
          className="hero-ken-burns absolute inset-0 bg-cover bg-[60%_50%]"
          style={{ backgroundImage: "url(/art/hero-bg.webp)" }}
        />
        {ready && motionOk && (
          <div className="absolute inset-0 animate-[rise-in_1.6s_ease-out_both]">
            <HeroBackdrop mouse={mouse} scroll={scroll} quality={quality} paused={!onScreen} />
          </div>
        )}
        {/* Legibility + atmosphere */}
        <div className="absolute inset-0 bg-gradient-to-r from-ink/88 via-ink/55 to-ink/25 sm:from-ink/85 sm:via-ink/35 sm:to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/65 via-ink/15 to-ink sm:from-ink/60 sm:via-transparent" />
        <div className="grid-lines absolute inset-0 opacity-50" />
        <div className="glow-cream absolute -left-52 bottom-0 h-[50vh] w-[50vh] opacity-30" />
      </div>

      <div
        className="relative mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-6 sm:px-8"
        data-hero-copy
      >
        <div className="max-w-xl lg:max-w-3xl">
          <h1
            data-hero-title
            className="font-display text-[clamp(1.9rem,calc((100vw-3rem)/8.45),3.25rem)] font-medium leading-[1.04] text-cream sm:text-6xl lg:text-[5rem]"
          >
            <span data-hero-line-mask className="split-line-mask">
              <span data-hero-line className="block">
                Out of static.
              </span>
            </span>
            <span data-hero-line-mask className="split-line-mask">
              <span
                data-hero-line
                className="flex flex-wrap items-baseline gap-x-[0.18em] gap-y-[0.15em] sm:gap-x-[0.28em]"
              >
                <span>Into</span>
                <LiquidWordmark />
              </span>
            </span>
          </h1>
          <p
            data-hero-sub
            className="mt-6 max-w-[34rem] text-justify text-[0.9375rem] leading-relaxed text-cream-2 [text-align-last:left] hyphens-auto sm:mt-7 sm:text-[1.075rem]"
          >
            We design custom AI and automation systems that replace slow,
            manual, disconnected workflows with operations that run themselves,
            so your team recovers time, margin and attention.
          </p>
          <div data-hero-cta className="mt-7 flex items-center gap-2.5 sm:mt-9 sm:flex-wrap sm:gap-3">
            <CtaButton href="#system" variant="solid" className="flex-1 sm:flex-none">
              <span className="sm:hidden">Try it live</span>
              <span className="hidden sm:inline">Explore the live system</span>
            </CtaButton>
            <CtaButton href="/contact" variant="ghost" className="flex-1 sm:flex-none">
              <span className="sm:hidden">Book a call</span>
              <span className="hidden sm:inline">Book a walkthrough</span>
            </CtaButton>
          </div>
        </div>
      </div>

      {/* Pain strip — what the system removes */}
      <div className="relative mx-auto mt-10 w-full max-w-7xl px-6 sm:mt-14 sm:px-8">
        <div className="hairline" />
        <p className="mt-5 text-center font-mono text-[10px] uppercase tracking-[0.28em] text-sand/80 sm:mt-6">
          The friction we remove
        </p>
        <ul
          data-hero-proof
          className="mx-auto mt-4 grid max-w-4xl grid-cols-2 gap-x-2 gap-y-5 text-center sm:mt-5 sm:gap-y-6 sm:grid-cols-4 sm:divide-x sm:divide-cream/10"
        >
          {PAINS.map(([pain, detail]) => (
            <li key={pain} className="px-1 sm:px-3">
              <p className="font-display flex items-center justify-center gap-1.5 text-[0.9375rem] leading-tight text-cream sm:gap-2 sm:text-xl">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="shrink-0 text-terra-bright/80"
                  aria-hidden
                >
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
                {pain}
              </p>
              <p className="mt-1.5 text-[10.5px] leading-snug text-sand sm:mt-2 sm:text-[11px]">
                {detail}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
