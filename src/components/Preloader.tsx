"use client";

import { useEffect, useRef, useState } from "react";
import { gsap, EASE } from "@/lib/gsap";
import { reveal } from "@/lib/reveal";
import { isEntryPath } from "@/lib/entry";
import { createTubeLiquid } from "./preloader/tubeLiquid";

/**
 * Brand preloader — "One lead, start to finish."
 *   Terracotta liquid flows along a glass tube through five stations —
 *   Inquiry → Qualify → Propose → Deliver → Collect — lighting each and
 *   stamping it (replied in 31s · HOT · signed · project live · paid). When the
 *   flow completes, the scene fades, the Flow State mark and wordmark appear,
 *   the veil lifts and the mark flies into the nav logo, where the hero's own
 *   liquid pour takes over.
 * While it runs, the hero's assets are fetched/decoded; the exit waits for them.
 * Plays once per browser session (a fresh tab replays it). Skipped for reduced motion.
 */

const ASSETS = [
  "/art/hero-bg.webp",
  "/brand/wordmark-liquid.png",
  "/brand/mark-256.webp",
  "/brand/wordmark.webp",
];
const SESSION_KEY = "fs:intro-played";

// Stage geometry (viewBox 900 x 400)
const VB_W = 900;
const VB_H = 400;
const TUBE = { x: 60, y: 168, w: 780, h: 44 };
const TUBE_CY = TUBE.y + TUBE.h / 2;
const STATIONS = [
  { x: 150, label: "Inquiry", stamp: "Replied in 31s" },
  { x: 300, label: "Qualify", stamp: "Scored HOT" },
  { x: 450, label: "Propose", stamp: "Signed" },
  { x: 600, label: "Deliver", stamp: "Project live" },
  { x: 750, label: "Collect", stamp: "Paid · Rs 2,400" },
] as const;
const MONO = "var(--font-geist-mono), ui-monospace, monospace";

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

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

const WORD_MASK = {
  WebkitMaskImage: "url(/brand/wordmark-liquid.png)",
  maskImage: "url(/brand/wordmark-liquid.png)",
  WebkitMaskSize: "100% 100%",
  maskSize: "100% 100%",
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
} as const;

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
    // plays only when the browser actually loaded the home page, and only once
    // per session (a new tab replays it).
    let seen = false;
    try {
      seen = sessionStorage.getItem(SESSION_KEY) === "1";
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* storage unavailable — play normally */
    }
    if (reduced || seen || !isEntryPath("/")) {
      reveal();
      gsap.to(el, {
        autoAlpha: 0,
        duration: 0.35,
        onComplete: () => setActive(false),
      });
      return;
    }

    document.documentElement.classList.add("is-preloading");
    // Deep links (/#system) are honoured once the intro has finished.
    const hash = window.location.hash;
    window.scrollTo(0, 0);
    const restoreHash = () => {
      if (!hash) return;
      const target = document.querySelector<HTMLElement>(hash);
      target?.scrollIntoView({ behavior: "auto", block: "start" });
    };

    // Warm the hero's assets immediately.
    let assetsReady = false;
    const fonts =
      "fonts" in document
        ? document.fonts.ready.then(() => undefined)
        : Promise.resolve();
    const readyPromise = Promise.all([fonts, ...ASSETS.map(preloadImage)]).then(
      () => {
        assetsReady = true;
      },
    );

    // Fluid inside the tube (WebGL); the SVG rect underneath is the fallback.
    const glCanvas = el.querySelector<HTMLCanvasElement>("[data-tube-gl]");
    const fluid = glCanvas ? createTubeLiquid(glCanvas) : null;
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __tubeFluid?: unknown }).__tubeFluid = fluid;
    }
    if (fluid && glCanvas) glCanvas.style.opacity = "1";
    // The shader pulls the current fill each frame — no dependence on tween
    // callbacks firing, so seeks/replays always match what is on screen.
    const fillState = { v: 0, agit: 0 };
    fluid?.setSource(() => ({ fill: fillState.v, agit: fillState.agit }));

    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(el);
      const stage = q<HTMLElement>("[data-stage]")[0];
      const veil = q<HTMLElement>("[data-veil]")[0];
      const flyer = q<HTMLElement>("[data-flyer]")[0];
      const tube = q<SVGGElement>("[data-tube]")[0];
      const liquidFallback = q<SVGRectElement>("[data-liquid-fallback]")[0];
      const stations = q<SVGGElement>("[data-station]");
      const stationCores = q<SVGCircleElement>("[data-station-core]");
      const stationRings = q<SVGCircleElement>("[data-station-ring]");
      const labels = q<SVGTextElement>("[data-label]");
      const stamps = q<HTMLElement>("[data-stamp]");
      const scene = q<HTMLElement>("[data-scene]")[0];
      const markWrap = q<HTMLElement>("[data-mark]")[0];
      const markImg = q<HTMLElement>("[data-mark-img]")[0];
      const wordEl = q<HTMLElement>("[data-word]")[0];
      const wordFill = q<HTMLElement>("[data-word-fill]")[0];
      const capA = q<HTMLElement>("[data-cap-a]")[0];
      const capB = q<HTMLElement>("[data-cap-b]")[0];

      // Centring lives in GSAP (it resets CSS `translate`, so Tailwind's -translate-* can't be relied on).
      gsap.set(stamps, { xPercent: -50, yPercent: -100 });
      gsap.set(markWrap, { xPercent: -50, yPercent: -50 });
      gsap.set(wordEl, { xPercent: -50 });
      gsap.set(wordFill, { yPercent: 100 });
      if (fluid) gsap.set(liquidFallback, { opacity: 0 });

      const compact = window.innerWidth < 640; // stamps hand off one at a time on phones

      const tl = gsap.timeline({ defaults: { ease: EASE.out } });
      if (process.env.NODE_ENV !== "production") {
        (
          window as unknown as { __preloader?: gsap.core.Timeline }
        ).__preloader = tl;
      }

      // ── 1. Scene: tube draws, stations settle in ─────────────────────
      tl.set(el, { autoAlpha: 1 })
        .fromTo(
          capA,
          { y: 8, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.4 },
          0.1,
        )
        .fromTo(scene, { opacity: 0 }, { opacity: 1, duration: 0.25 }, 0.1)
        .fromTo(
          tube,
          { scaleX: 0, transformOrigin: "0% 50%" },
          { scaleX: 1, duration: 0.55, ease: "power3.inOut" },
          0.12,
        )
        .fromTo(
          stations,
          { scale: 0, transformOrigin: "50% 50%", opacity: 0 },
          {
            scale: 1,
            opacity: 1,
            duration: 0.38,
            stagger: 0.05,
            ease: "back.out(2)",
          },
          0.32,
        )
        .fromTo(
          labels,
          { y: 6, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.32, stagger: 0.05 },
          0.4,
        );

      // ── 2. The flow: one continuous run; stations light as the front passes ──
      const FLOW_START = 0.75;
      const FLOW_DUR = 1.9;
      const fillTo = (x: number) => (x - TUBE.x + 6) / TUBE.w;
      // Linear so "fill fraction" maps directly to time — station events land exactly
      // when the liquid front reaches them.
      tl.to(fillState, { v: 1, duration: FLOW_DUR, ease: "none" }, FLOW_START)
        .to(
          liquidFallback,
          { attr: { width: TUBE.w }, duration: FLOW_DUR, ease: "none" },
          FLOW_START,
        )
        // turbulence: rises as the flow starts, eases off as it completes
        .fromTo(
          fillState,
          { agit: 0.15 },
          { agit: 0.75, duration: 0.35, ease: "power2.out" },
          FLOW_START,
        )
        .to(
          fillState,
          { agit: 0.25, duration: 0.5, ease: "power2.inOut" },
          FLOW_START + FLOW_DUR - 0.45,
        );
      STATIONS.forEach((s, i) => {
        const at = FLOW_START + FLOW_DUR * fillTo(s.x);
        tl.to(
          stationCores[i],
          { fill: "#e0784f", stroke: "#f3e9dc", duration: 0.2 },
          at,
        )
          .fromTo(
            stationRings[i],
            { attr: { r: 14 }, opacity: 0.9 },
            {
              attr: { r: 32 },
              opacity: 0,
              duration: 0.45,
              ease: "power2.out",
              immediateRender: false,
            },
            at,
          )
          .to(labels[i], { fill: "#f3e9dc", duration: 0.2 }, at)
          .fromTo(
            stamps[i],
            { y: 8, opacity: 0, scale: 0.9 },
            {
              y: 0,
              opacity: 1,
              scale: 1,
              duration: 0.28,
              ease: "back.out(2)",
              immediateRender: false,
            },
            at + 0.02,
          );
        if (compact && i > 0)
          tl.to(stamps[i - 1], { opacity: 0, y: -6, duration: 0.15 }, at);
      });
      const t = FLOW_START + FLOW_DUR;

      // ── 3. Brand moment: scene fades, mark + wordmark appear ─────────
      const T3 = t + 0.3;
      tl.to(capA, { opacity: 0, y: -6, duration: 0.25 }, T3)
        .to(stamps, { opacity: 0, y: -6, duration: 0.25, stagger: 0.02 }, T3)
        .to(
          scene,
          { opacity: 0, y: -14, duration: 0.45, ease: "power2.in" },
          T3 + 0.05,
        )
        .fromTo(
          markWrap,
          { opacity: 0, scale: 0.6 },
          {
            opacity: 1,
            scale: 1,
            duration: 0.65,
            ease: "back.out(1.5)",
            immediateRender: false,
          },
          T3 + 0.25,
        )
        .fromTo(
          wordEl,
          { opacity: 0, y: 8 },
          { opacity: 1, y: 0, duration: 0.4, immediateRender: false },
          T3 + 0.5,
        )
        .to(
          wordFill,
          { yPercent: 6, duration: 0.65, ease: "power2.inOut" },
          T3 + 0.55,
        )
        .fromTo(
          capB,
          { y: 8, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.4, immediateRender: false },
          T3 + 0.7,
        );

      // ── hold until assets are ready ─────────────────────────────────
      const HOLD = T3 + 1.2;
      tl.call(
        () => {
          if (!assetsReady) {
            tl.pause();
            void readyPromise.then(() => tl.play());
          }
        },
        [],
        HOLD,
      );

      // ── 4. Exit: reveal hero, wipe the veil, fly the mark into the nav ──
      tl.call(reveal, [], HOLD + 0.02);
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
              duration: 0.75,
              ease: "power3.inOut",
              onComplete: () => {
                document.documentElement.classList.remove("is-preloading");
                gsap.to(flyer, { autoAlpha: 0, duration: 0.2 });
              },
            });
          } else {
            gsap.to(flyer, { autoAlpha: 0, duration: 0.3 });
            document.documentElement.classList.remove("is-preloading");
          }
        },
        [],
        HOLD + 0.05,
      );
      tl.to(
        [wordEl, capB],
        { opacity: 0, y: -10, duration: 0.35, ease: "power2.in" },
        HOLD + 0.05,
      )
        .to(
          stage,
          { opacity: 0, duration: 0.45, ease: "power2.in" },
          HOLD + 0.25,
        )
        .to(
          veil,
          {
            clipPath: "inset(0 0 100% 0)",
            duration: 0.8,
            ease: "power4.inOut",
          },
          HOLD + 0.15,
        )
        .call(
          () => {
            document.documentElement.classList.remove("is-preloading");
            restoreHash();
            setActive(false);
          },
          [],
          HOLD + 0.95,
        );
    }, el);

    return () => {
      ctx.revert();
      fluid?.destroy();
      document.documentElement.classList.remove("is-preloading");
    };
  }, []);

  if (!active) return null;

  return (
    <div
      ref={root}
      className="fixed inset-0 z-[100]"
      aria-hidden
      data-lenis-prevent
      style={{ visibility: "hidden" }}
    >
      {/* Veil (wipes upward on exit) */}
      <div
        data-veil
        className="absolute inset-0 bg-ink"
        style={{ clipPath: "inset(0 0 0 0)" }}
      >
        <div className="grid-lines absolute inset-0 opacity-40" />
        <div className="glow-terra absolute left-1/2 top-1/2 h-[70vh] w-[70vh] -translate-x-1/2 -translate-y-1/2 opacity-25" />
      </div>

      {/* Stage */}
      <div
        data-stage
        className="absolute inset-0 flex flex-col items-center justify-center px-4"
      >
        <div className="relative mb-2 h-6 w-[min(920px,94vw)]">
          <p
            data-cap-a
            className="absolute left-0 top-0 font-mono text-[11px] uppercase tracking-[0.3em] text-sand opacity-0"
          >
            One lead · start to finish
          </p>
          <p
            data-cap-b
            className="absolute inset-x-0 top-0 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-terra-bright opacity-0"
          >
            First message to money — in flow
          </p>
        </div>

        <div
          className="relative w-[min(920px,94vw)]"
          style={{ aspectRatio: `${VB_W} / ${VB_H}` }}
        >
          {/* Scene: tube + stations + stamps (fades out before the brand moment) */}
          <div data-scene className="absolute inset-0 opacity-0">
            {/* Fluid canvas sits exactly over the tube, under the SVG so the glass stroke/highlight stay in front */}
            <canvas
              data-tube-gl
              className="absolute opacity-0 transition-opacity duration-300"
              style={{
                left: pct(TUBE.x, VB_W),
                top: pct(TUBE.y, VB_H),
                width: pct(TUBE.w, VB_W),
                height: pct(TUBE.h, VB_H),
                filter: "drop-shadow(0 0 14px rgba(224,120,79,0.35))",
              }}
            />
            <svg
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              className="absolute inset-0 h-full w-full overflow-visible"
              fill="none"
            >
              <defs>
                <clipPath id="pl-tube-clip">
                  <rect
                    x={TUBE.x}
                    y={TUBE.y}
                    width={TUBE.w}
                    height={TUBE.h}
                    rx={TUBE.h / 2}
                  />
                </clipPath>
                <linearGradient id="pl-liquid" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#f0a07c" />
                  <stop offset="0.45" stopColor="#dc6c45" />
                  <stop offset="1" stopColor="#8e3e24" />
                </linearGradient>
                <linearGradient id="pl-glass" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="rgba(243,233,220,0.14)" />
                  <stop offset="0.5" stopColor="rgba(243,233,220,0.03)" />
                  <stop offset="1" stopColor="rgba(243,233,220,0.07)" />
                </linearGradient>
              </defs>

              {/* Tube (glass), with an SVG liquid rect as the no-WebGL fallback */}
              <g data-tube>
                <g clipPath="url(#pl-tube-clip)">
                  <rect
                    data-liquid-fallback
                    x={TUBE.x}
                    y={TUBE.y}
                    width="0"
                    height={TUBE.h}
                    fill="url(#pl-liquid)"
                  />
                </g>
                <rect
                  x={TUBE.x}
                  y={TUBE.y}
                  width={TUBE.w}
                  height={TUBE.h}
                  rx={TUBE.h / 2}
                  fill="url(#pl-glass)"
                  stroke="rgba(243,233,220,0.24)"
                  strokeWidth="1.2"
                />
                <rect
                  x={TUBE.x + 24}
                  y={TUBE.y + 6}
                  width={TUBE.w - 48}
                  height="4"
                  rx="2"
                  fill="rgba(255,255,255,0.2)"
                />
              </g>

              {/* Stations */}
              {STATIONS.map((s, i) => (
                <g key={s.label}>
                  <circle
                    data-station-ring
                    cx={s.x}
                    cy={TUBE_CY}
                    r="14"
                    stroke="#e0784f"
                    strokeWidth="1.5"
                    opacity="0"
                  />
                  <g data-station>
                    <circle
                      cx={s.x}
                      cy={TUBE_CY}
                      r="19"
                      fill="#0b0806"
                      stroke="rgba(243,233,220,0.24)"
                      strokeWidth="1.2"
                    />
                    <circle
                      data-station-core
                      cx={s.x}
                      cy={TUBE_CY}
                      r="8"
                      fill="rgba(243,233,220,0.18)"
                      stroke="rgba(243,233,220,0.35)"
                      strokeWidth="1"
                    />
                  </g>
                  <text
                    data-label
                    x={s.x}
                    y={TUBE.y + TUBE.h + 34}
                    textAnchor="middle"
                    fill="#9c8e7e"
                    fontFamily={MONO}
                    fontSize="11.5"
                    letterSpacing="2.4"
                  >
                    {s.label.toUpperCase()}
                  </text>
                  <text
                    data-num
                    x={s.x}
                    y={TUBE.y + TUBE.h + 52}
                    textAnchor="middle"
                    fill="rgba(156,142,126,0.55)"
                    fontFamily={MONO}
                    fontSize="10"
                    letterSpacing="1.5"
                  >
                    0{i + 1}
                  </text>
                </g>
              ))}
            </svg>

            {/* Stamps above stations */}
            {STATIONS.map((s) => (
              <div
                key={s.stamp}
                data-stamp
                className="pointer-events-none absolute whitespace-nowrap border border-terra/40 bg-ink/85 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-terra-bright opacity-0 backdrop-blur-sm sm:px-2.5 sm:text-[10.5px] sm:tracking-[0.16em]"
                style={{ left: pct(s.x, VB_W), top: pct(TUBE.y - 26, VB_H) }}
              >
                <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-terra-bright align-middle" />
                {s.stamp}
              </div>
            ))}
          </div>

          {/* Brand moment: mark + wordmark, centred */}
          <div
            data-mark
            className="pointer-events-none absolute left-1/2 opacity-0"
            style={{
              top: "42%",
              width: "clamp(72px, 13.5%, 124px)",
              aspectRatio: "598 / 612",
            }}
          >
            <div className="glow-terra absolute inset-[-45%] opacity-70" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              data-mark-img
              src="/brand/mark-256.webp"
              alt=""
              className="absolute inset-0 h-full w-full object-contain"
            />
          </div>
          <div
            data-word
            className="pointer-events-none absolute left-1/2 opacity-0"
            style={{
              top: "62%",
              width: "clamp(130px, 22%, 204px)",
              aspectRatio: "652 / 70",
              ...WORD_MASK,
            }}
          >
            <div className="absolute inset-0 bg-[#3a1a0e]" />
            <div
              data-word-fill
              className="absolute inset-0 bg-gradient-to-t from-[#8e3e24] via-[#dc6c45] to-[#f7c9b0]"
            />
          </div>
        </div>
      </div>

      {/* Flying mark (outside the veil clip) */}
      <div
        data-flyer
        className="pointer-events-none fixed left-0 top-0 opacity-0"
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
