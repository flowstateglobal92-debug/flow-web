"use client";

import { useRef, type ElementType, type ReactNode } from "react";
import { gsap, useGSAP, EASE } from "@/lib/gsap";

type Props = {
  children: ReactNode;
  /** Selector for the children to stagger. Omit to animate the wrapper itself. */
  stagger?: string;
  as?: ElementType;
  className?: string;
  y?: number;
  delay?: number;
};

/**
 * Reveals content once as it scrolls into view. Wraps the ScrollTrigger setup
 * so individual sections stay declarative.
 */
export default function ScrollReveal({
  children,
  stagger,
  as: Tag = "div",
  className,
  y = 42,
  delay = 0,
}: Props) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const targets = stagger
          ? root.current!.querySelectorAll(stagger)
          : [root.current!];

        // Explicit start/end values (rather than `from`) so the end state never
        // depends on whatever the element's computed style happens to be at
        // creation time — e.g. mid-CSS-transition during React's double effect.
        gsap.set(targets, { y, opacity: 0 });
        gsap.to(targets, {
          y: 0,
          opacity: 1,
          duration: 0.95,
          delay,
          ease: EASE.out,
          stagger: stagger ? 0.11 : 0,
          clearProps: "transform",
          scrollTrigger: {
            trigger: root.current,
            start: "top 82%",
            // Fires once; re-running on scroll-up reads as jitter, not polish.
            once: true,
          },
        });
      });

      return () => mm.revert();
    },
    { scope: root },
  );

  // Polymorphic `as` narrows JSX props to `never`; cast keeps the ref typed.
  const Comp = Tag as "div";
  return (
    <Comp ref={root} className={className}>
      {children}
    </Comp>
  );
}
