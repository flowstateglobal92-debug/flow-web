"use client";

import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// Plugins touch `window`, and client components are still rendered on the
// server, so registration has to stay behind a browser check.
// ScrollTrigger is the only one the site actually drives — SplitText, Flip and
// ScrollToPlugin were registered on every route and called from nowhere.
if (typeof window !== "undefined") {
  gsap.registerPlugin(useGSAP, ScrollTrigger);
}

/** Shared easing + timing so every section moves with the same character. */
export const EASE = {
  out: "power3.out",
  inOut: "power3.inOut",
  expo: "expo.out",
} as const;

export { gsap, useGSAP, ScrollTrigger };
