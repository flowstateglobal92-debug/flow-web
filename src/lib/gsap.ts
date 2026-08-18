"use client";

import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { SplitText } from "gsap/SplitText";
import { Flip } from "gsap/Flip";

// Plugins touch `window`, and client components are still rendered on the
// server, so registration has to stay behind a browser check.
if (typeof window !== "undefined") {
  gsap.registerPlugin(useGSAP, ScrollTrigger, ScrollToPlugin, SplitText, Flip);
}

/** Shared easing + timing so every section moves with the same character. */
export const EASE = {
  out: "power3.out",
  inOut: "power3.inOut",
  expo: "expo.out",
} as const;

export { gsap, useGSAP, ScrollTrigger, ScrollToPlugin, SplitText, Flip };
