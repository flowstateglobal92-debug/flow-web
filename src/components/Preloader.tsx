"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "@/lib/gsap";
import { reveal } from "@/lib/reveal";
import { isEntryPath } from "@/lib/entry";
import { INTRO_LIVE_ATTR } from "@/lib/intro";
import { createPourLiquid } from "./preloader/pourLiquid";

/**
 * Brand intro — "The Pour."
 *   Black frame with the Flow State mark standing in it as an empty glass
 *   vessel. Terracotta liquid surges down from the top edge, flooding the
 *   viewport and filling the mark at the same time; once full, the mark
 *   solidifies into the real two-tone logo. Then the liquid lets go and drains
 *   off the bottom, uncovering the hero with its own liquid pour already under
 *   way, while the mark flies into the nav logo. 2.5s door to door.
 * The hero's assets are warmed while it plays. Plays on every load of the home
 * page (a refresh replays it); skipped for reduced motion and for client-side
 * navigations back to "/".
 */

const ASSETS = [
  "/art/hero-bg.webp",
  "/brand/wordmark-liquid.png",
  "/brand/mark-256.webp",
  "/brand/mark-mask.png",
  "/brand/wordmark.webp",
];
/** Crisp silhouette of the mark (the logo's own alpha, glow removed). */
const MARK_MASK = {
  WebkitMaskImage: "url(/brand/mark-mask.png)",
  maskImage: "url(/brand/mark-mask.png)",
  WebkitMaskSize: "100% 100%",
  maskSize: "100% 100%",
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
} as const;

/**
 * The intro is 2.5s. If the hero's assets still are not in when the drain is
 * due, it holds — but never past this point (measured from mount), so a slow
 * connection can stretch the intro a little and never strand the visitor.
 */
const ASSET_WAIT_CAP_MS = 2500;

function preloadImage(src: string) {
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const d = img.decode?.();
      if (d)
        d.then(
          () => resolve(),
          () => resolve(),
        );
      else resolve();
    };
    img.onerror = () => resolve();
    img.src = src;
  });
}

export default function Preloader() {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true);

  useEffect(() => {
    const el = root.current;
    if (!el) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // The intro belongs to arriving at the site, not to moving around it: it
    // plays only when the browser actually loaded the home page.
    if (reduced || !isEntryPath("/")) {
      // The boot script applies the same conditions, so it will not have marked
      // the document — clear it anyway so a mismatch can never strand the veil.
      document.documentElement.classList.remove("is-preloading");
      reveal();
      gsap.to(el, {
        autoAlpha: 0,
        duration: 0.35,
        onComplete: () => setActive(false),
      });
      return;
    }

    document.documentElement.classList.add("is-preloading");
    // Tells the boot script's failsafe that the intro is under way, so it stops
    // watching for a hydration that never arrived.
    document.documentElement.setAttribute(INTRO_LIVE_ATTR, "");
    // Deep links (/#system) are honoured once the intro has finished.
    const hash = window.location.hash;
    window.scrollTo(0, 0);
    const restoreHash = () => {
      if (!hash) return;
      const target = document.querySelector<HTMLElement>(hash);
      target?.scrollIntoView({ behavior: "auto", block: "start" });
    };

    // Warm the hero's assets immediately; the drain waits for them, briefly.
    let assetsReady = false;
    const fonts =
      "fonts" in document
        ? document.fonts.ready.then(() => undefined)
        : Promise.resolve();
    const readyPromise = Promise.race([
      Promise.all([fonts, ...ASSETS.map(preloadImage)]),
      new Promise<void>((r) => setTimeout(r, ASSET_WAIT_CAP_MS)),
    ]).then(() => {
      assetsReady = true;
    });

    // The liquid (WebGL); the gradient div underneath is the fallback.
    const glCanvas = el.querySelector<HTMLCanvasElement>("[data-pour-gl]");
    const fluid = glCanvas ? createPourLiquid(glCanvas) : null;
    if (fluid && glCanvas) glCanvas.style.opacity = "1";
    // The shader pulls the current state each frame — no dependence on tween
    // callbacks firing, so seeks/replays always match what is on screen.
    const pour = { front: 0, top: 0 };
    fluid?.setSource(() => ({ front: pour.front, top: pour.top }));

    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(el);
      const veil = q<HTMLElement>("[data-veil]")[0];
      const fallback = q<HTMLElement>("[data-pour-fallback]")[0];
      const markWrap = q<HTMLElement>("[data-mark]")[0];
      const markImg = q<HTMLElement>("[data-mark-img]")[0];
      const markFill = q<HTMLElement>("[data-mark-fill]")[0];
      const markGlass = q<HTMLElement>("[data-mark-glass]")[0];
      const flyer = q<HTMLElement>("[data-flyer]")[0];

      // Centring lives in GSAP (it resets CSS `translate`, so Tailwind's -translate-* can't be relied on).
      gsap.set(markWrap, { xPercent: -50, yPercent: -50 });
      gsap.set(markFill, { yPercent: 100 }); // the vessel starts empty
      if (fluid) gsap.set(fallback, { display: "none" });

      const tl = gsap.timeline();
      if (process.env.NODE_ENV !== "production") {
        (
          window as unknown as { __preloader?: gsap.core.Timeline }
        ).__preloader = tl;
      }

      // Beat map — 2.5s total. The liquid moves at its original pace (a fast
      // surge, a fast fall); the length comes from the brand beat in the
      // middle, not from slowing the fluid down. Critically the drain is all
      // but finished before the mark flies, so the mark crosses the hero rather
      // than swimming through liquid on its way to the nav.
      const VESSEL_AT = 0.05;
      const VESSEL = 0.35; // the empty glass mark appears on black
      const SURGE_AT = 0.1;
      const SURGE = 0.55; // liquid floods the viewport
      const FILL_AT = 0.2;
      const FILL = 0.7; // …and fills the mark at the same time
      const SOLID_AT = FILL_AT + FILL; // 0.9 — full, so it becomes the real logo
      const SOLID = 0.25;
      const SETTLE_AT = 1.1;
      const SETTLE = 0.3;
      const DRAIN_AT = SETTLE_AT + SETTLE; // 1.4
      const DRAIN = 0.55;
      const FLY_AT = DRAIN_AT + 0.5; // 1.9 — the frame is essentially clear
      const FLY = 0.5;
      const END = 2.5;

      // ── 1. The empty vessel, then the surge ──────────────────────────
      tl.set(el, { autoAlpha: 1 })
        .fromTo(
          markWrap,
          { opacity: 0, scale: 0.86 },
          { opacity: 1, scale: 1, duration: VESSEL, ease: "power2.out" },
          VESSEL_AT,
        )
        .to(pour, { front: 1, duration: SURGE, ease: "power2.in" }, SURGE_AT)
        .fromTo(
          fallback,
          { scaleY: 0, transformOrigin: "50% 0%" },
          { scaleY: 1, duration: SURGE, ease: "power2.in" },
          SURGE_AT,
        );

      // ── 2. The mark fills, sloshing as it goes ───────────────────────
      tl.to(
        markFill,
        { yPercent: 2, duration: FILL, ease: "power1.inOut" },
        FILL_AT,
      )
        // surface tilt: the liquid is moving, not a bar sliding up
        .fromTo(
          markFill,
          { rotate: -2.2 },
          {
            rotate: 1.6,
            duration: FILL * 0.55,
            ease: "sine.inOut",
            yoyo: true,
            repeat: 1,
          },
          FILL_AT,
        )
        .to(markFill, { rotate: 0, duration: 0.3, ease: "sine.out" }, SOLID_AT)
        // the glass shell dims only slightly — it has to keep reading as an
        // empty vessel against the liquid behind it
        .to(
          markGlass,
          { opacity: 0.7, duration: FILL * 0.6, ease: "none" },
          FILL_AT,
        );

      // ── 3. Full — the mark solidifies into the real logo ─────────────
      tl.to(
        markImg,
        { opacity: 1, duration: SOLID, ease: "power2.out" },
        SOLID_AT,
      )
        .to(
          markWrap,
          { scale: 1.07, duration: 0.18, ease: "power2.out" },
          SOLID_AT,
        )
        .to(
          markWrap,
          { scale: 1, duration: 0.3, ease: "power2.out" },
          SOLID_AT + 0.18,
        )
        // a slow breath while the liquid moves around it
        .to(
          markWrap,
          { scale: 1.04, duration: SETTLE, ease: "sine.inOut" },
          SETTLE_AT,
        );

      // ── hold — the mark sits in the liquid while the hero finishes loading ──
      tl.call(
        () => {
          if (!assetsReady) {
            tl.pause();
            void readyPromise.then(() => tl.play());
          }
        },
        [],
        DRAIN_AT - 0.01,
      );

      // ── 4. Drain: hero is revealed and the liquid falls away ────────
      tl.call(reveal, [], DRAIN_AT);
      tl.set(veil, { autoAlpha: 0 }, DRAIN_AT)
        .to(pour, { top: 1, duration: DRAIN, ease: "power2.in" }, DRAIN_AT)
        .to(
          fallback,
          { yPercent: 100, duration: DRAIN, ease: "power2.in" },
          DRAIN_AT,
        );

      // ── 5. …and only then the mark flies, across the visible hero ────
      tl.call(
        () => {
          const from = markImg.getBoundingClientRect();
          const navMark =
            document.querySelector<HTMLElement>("[data-nav-mark]");
          const to = navMark?.getBoundingClientRect();
          gsap.set(flyer, {
            left: from.left,
            top: from.top,
            width: from.width,
            height: from.height,
            autoAlpha: 1,
          });
          gsap.set(markWrap, { opacity: 0 });
          if (to) {
            gsap.to(flyer, {
              left: to.left,
              top: to.top,
              width: to.width,
              height: to.height,
              duration: FLY,
              ease: "power3.inOut",
              onComplete: () => {
                document.documentElement.classList.remove("is-preloading");
                gsap.to(flyer, { autoAlpha: 0, duration: 0.18 });
              },
            });
          } else {
            gsap.to(flyer, { autoAlpha: 0, duration: 0.3 });
            document.documentElement.classList.remove("is-preloading");
          }
        },
        [],
        FLY_AT,
      );
      tl.call(
        () => {
          document.documentElement.classList.remove("is-preloading");
          document.documentElement.removeAttribute(INTRO_LIVE_ATTR);
          restoreHash();
          setActive(false);
        },
        [],
        END,
      );
    }, el);

    return () => {
      ctx.revert();
      fluid?.destroy();
      document.documentElement.classList.remove("is-preloading");
      document.documentElement.removeAttribute(INTRO_LIVE_ATTR);
    };
  }, []);

  if (!active) return null;

  return (
    <div
      ref={root}
      data-preloader
      className="pointer-events-none fixed inset-0 z-[100]"
      aria-hidden
      data-lenis-prevent
      style={{ visibility: "hidden" }}
    >
      {/* Black frame — dropped the instant the liquid fully covers it */}
      <div data-veil className="absolute inset-0 bg-ink" />

      {/* The liquid: WebGL, with a CSS gradient as the no-WebGL fallback */}
      <div
        data-pour-fallback
        className="absolute inset-0 bg-gradient-to-b from-[#f0a07c] via-[#dc6c45] to-[#8e3e24]"
      />
      <canvas
        data-pour-gl
        className="absolute inset-0 h-full w-full opacity-0 transition-opacity duration-200"
      />

      {/* The mark: an empty glass vessel that fills with the pour, then
          solidifies into the real logo */}
      <div
        data-mark
        className="absolute left-1/2 top-1/2 opacity-0"
        style={{
          width: "clamp(128px, 20vmin, 200px)",
          aspectRatio: "598 / 612",
        }}
      >
        {/* Depth behind the mark, so the glass reads against black and liquid alike */}
        <div
          className="absolute inset-[-80%] rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, rgba(38,11,4,0.6), rgba(38,11,4,0.25) 45%, transparent 72%)",
          }}
        />
        <div className="absolute inset-[-8%] rounded-full bg-[#f7c9b0]/20 blur-xl" />

        {/* Vessel: everything inside is clipped to the mark's silhouette */}
        <div className="absolute inset-0" style={MARK_MASK}>
          {/* empty glass */}
          <div data-mark-glass className="absolute inset-0 bg-cream/[0.14]" />
          {/* the liquid — wider and taller than the vessel so the tilted
              surface never exposes a corner. Its top edge IS the surface, so
              the shading is keyed to the top: bright lip, then straight into
              deep terracotta, matching the full-screen pour. */}
          <div
            data-mark-fill
            className="absolute inset-x-[-30%] top-0 bottom-[-22%]"
          >
            <div className="absolute inset-0 bg-[#8f3f24]" />
            <div className="absolute inset-x-0 top-0 h-[22%] bg-gradient-to-b from-[#f0a07c] via-[#c9542f] to-transparent" />
            {/* meniscus */}
            <div className="absolute inset-x-0 top-0 h-[3.5%] bg-[#ffe0cc]" />
          </div>
        </div>

        {/* The real logo, cross-faded in once the vessel is full */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          data-mark-img
          src="/brand/mark-256.webp"
          alt=""
          className="absolute inset-0 h-full w-full object-contain opacity-0 drop-shadow-[0_10px_30px_rgba(38,11,4,0.7)]"
        />
      </div>

      {/* Flying mark (rides above the draining liquid into the nav) */}
      <div
        data-flyer
        className="fixed left-0 top-0 opacity-0"
        style={{ visibility: "hidden" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/mark-256.webp"
          alt=""
          className="h-full w-full object-contain"
        />
      </div>
    </div>
  );
}
