"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The rendered width of a chart's box. Starts from a guess so the server and
 * the first client render agree, then follows the element as it resizes.
 */
export function useWidth<T extends HTMLElement>(initial = 640) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
