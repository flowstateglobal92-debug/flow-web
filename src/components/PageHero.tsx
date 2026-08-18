"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { gsap, useGSAP, ScrollTrigger, EASE } from "@/lib/gsap";

type Props = {
  eyebrow: ReactNode;
  /** Headline lines — each is revealed with its own mask, like the home hero. */
  lines: ReactNode[];
  sub?: ReactNode;
  actions?: ReactNode;
  /** Full-bleed backdrop. `focus` is the CSS background-position (where the subject sits). */
  image: { src: string; focus?: string; alt?: string };
  /** Optional ambient loop layered over the still (muted, inline, respects reduced motion). */
  video?: { src: string };
  /** Content rendered under the copy inside the same viewport-height stage (stat strips, sub-navs). */
  children?: ReactNode;
  /** Optional panel to the right of the copy (a form, a card). */
  aside?: ReactNode;
  /** Shorter stage for utility pages. */
  compact?: boolean;
  id?: string;
};

/**
 * Inner-page opener. Same grammar as the home hero — dark warm imagery under
 * legibility gradients, masked headline lines, copy on the left — but calmer
 * and shorter so the page's own content arrives sooner.
 */
export default function PageHero({
  eyebrow,
  lines,
  sub,
  actions,
  image,
  video,
  children,
  aside,
  compact = false,
  id = "top",
}: Props) {
  const root = useRef<HTMLElement>(null);
  const [motionOk, setMotionOk] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- media preference is only knowable on the client
    setMotionOk(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const masks = gsap.utils.toArray<HTMLElement>("[data-ph-mask]");
        const restore = () => masks.forEach((m) => (m.style.overflow = "visible"));
        const tl = gsap.timeline({ defaults: { ease: EASE.expo }, onComplete: restore });

        // Only tween what this instance actually rendered — `sub`, `actions`,
        // `aside` and `children` are all optional, and GSAP warns on empty targets.
        const add = (selector: string, vars: gsap.TweenVars, at: number) => {
          const targets = gsap.utils.toArray<HTMLElement>(selector);
          if (targets.length) tl.from(targets, vars, at);
        };
        add("[data-ph-eyebrow]", { y: 14, opacity: 0, duration: 0.8 }, 0.1);
        add("[data-ph-line]", { yPercent: 110, duration: 1.2, stagger: 0.1 }, 0.15);
        add("[data-ph-sub]", { y: 20, opacity: 0, duration: 0.9 }, 0.5);
        add("[data-ph-actions] > *", { y: 16, opacity: 0, duration: 0.8, stagger: 0.08 }, 0.65);
        add("[data-ph-aside]", { y: 28, opacity: 0, duration: 1 }, 0.55);
        add("[data-ph-extra]", { y: 16, opacity: 0, duration: 0.8 }, 0.85);

        // Copy drifts up and fades as the page scrolls on — same as the home hero.
        gsap.to("[data-ph-copy]", {
          yPercent: -14,
          opacity: 0.15,
          ease: "none",
          scrollTrigger: {
            trigger: root.current,
            start: "top top",
            end: "80% top",
            scrub: true,
          },
        });
        // Backdrop parallax.
        gsap.to("[data-ph-bg]", {
          yPercent: 12,
          ease: "none",
          scrollTrigger: {
            trigger: root.current,
            start: "top top",
            end: "bottom top",
            scrub: true,
          },
        });
        return restore;
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  // Make sure downstream ScrollTriggers measure against the settled layout.
  useEffect(() => {
    const id = requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <section
      id={id}
      ref={root}
      className={`relative isolate flex flex-col justify-end overflow-hidden pb-10 pt-[calc(var(--nav-h)+2rem)] sm:pb-14 ${
        compact ? "min-h-[72svh]" : "min-h-[86svh]"
      }`}
    >
      <div className="absolute inset-0 -z-20" aria-hidden>
        <div data-ph-bg className="absolute -inset-y-[8%] inset-x-0">
          <div
            className="hero-ken-burns absolute inset-0 bg-cover"
            style={{ backgroundImage: `url(${image.src})`, backgroundPosition: image.focus ?? "70% 50%" }}
          />
          {video && motionOk && (
            <video
              className="absolute inset-0 h-full w-full object-cover animate-[rise-in_1.6s_ease-out_both]"
              style={{ objectPosition: image.focus ?? "70% 50%" }}
              src={video.src}
              muted
              loop
              playsInline
              autoPlay
              preload="metadata"
              disablePictureInPicture
              disableRemotePlayback
              tabIndex={-1}
            />
          )}
        </div>
        {/* With an aside panel the imagery becomes atmosphere, not a subject:
            wash the whole frame so the panel stays the brightest thing on it. */}
        <div
          className={`absolute inset-0 bg-gradient-to-r ${
            aside ? "from-ink/92 via-ink/70 to-ink/80" : "from-ink/90 via-ink/45 to-ink/5"
          }`}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/70 via-transparent to-ink" />
        <div className="grid-lines absolute inset-0 opacity-40" />
        <div className="glow-cream absolute -left-52 bottom-0 h-[50vh] w-[50vh] opacity-25" />
      </div>

      <div
        className={`relative mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-6 sm:px-8 ${
          aside ? "lg:grid lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-center lg:gap-14" : ""
        }`}
      >
        <div data-ph-copy className={aside ? "max-w-xl" : "max-w-xl lg:max-w-4xl"}>
          <p data-ph-eyebrow className="eyebrow">
            {eyebrow}
          </p>
          <h1
            className={`font-display mt-5 font-medium leading-[1.04] text-cream ${
              aside ? "text-[2.6rem] sm:text-5xl lg:text-[3.6rem]" : "text-[2.75rem] sm:text-6xl lg:text-[4.25rem]"
            }`}
          >
            {lines.map((line, i) => (
              <span key={i} data-ph-mask className="split-line-mask">
                <span data-ph-line className="block">
                  {line}
                </span>
              </span>
            ))}
          </h1>
          {sub && (
            <p
              data-ph-sub
              className="mt-7 max-w-[34rem] text-justify text-base leading-relaxed text-cream-2 [text-align-last:left] hyphens-auto sm:text-[1.075rem]"
            >
              {sub}
            </p>
          )}
          {actions && (
            <div data-ph-actions className="mt-9 flex flex-wrap items-center gap-3">
              {actions}
            </div>
          )}
        </div>
        {aside && (
          <div data-ph-aside className="mt-12 lg:mt-0">
            {aside}
          </div>
        )}
      </div>

      {children && (
        <div data-ph-extra className="relative mx-auto mt-14 w-full max-w-7xl px-6 sm:px-8">
          {children}
        </div>
      )}
    </section>
  );
}
