"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { SHEET_WIDTH } from "./InvoiceDocument";

/**
 * Shows an A4 sheet (794px wide) scaled to its column. With `fitHeight` it
 * also shrinks to fit the viewport below `offset`, but never below ~60% of
 * the width fit — past that the container scrolls instead of going tiny.
 * The wrapper's height follows the scaled height so nothing overlaps.
 *
 * Sizes are measured in ResizeObserver / resize callbacks only. In print the
 * transform is dropped (globals.css) and the sheet prints at real size.
 */
export default function ScaledSheet({
  children,
  fitHeight = false,
  offset = 0,
  maxScale = 1,
  className = "",
}: {
  children: ReactNode;
  fitHeight?: boolean;
  offset?: number;
  maxScale?: number;
  className?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ scale: number; height: number; left: number } | null>(null);

  useEffect(() => {
    const outer = frame.current;
    const inner = sheet.current;
    if (!outer || !inner) return;

    const measure = () => {
      const width = outer.clientWidth;
      const natural = inner.offsetHeight;
      if (!width || !natural) return;
      const byWidth = Math.min(maxScale, width / SHEET_WIDTH);
      let scale = byWidth;
      if (fitHeight) {
        const room = window.innerHeight - offset;
        scale = Math.min(byWidth, Math.max(room / natural, byWidth * 0.6));
      }
      const next = {
        scale,
        height: Math.ceil(natural * scale),
        left: Math.max(0, Math.floor((width - SHEET_WIDTH * scale) / 2)),
      };
      // The frame's own resize re-fires this; keep the old object when nothing moved.
      setBox((prev) =>
        prev && prev.scale === next.scale && prev.height === next.height && prev.left === next.left ? prev : next,
      );
    };

    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [fitHeight, offset, maxScale]);

  return (
    <div ref={frame} data-sheet-frame className={`relative w-full ${className}`} style={{ height: box?.height ?? 0 }}>
      <div
        ref={sheet}
        data-sheet-scale
        className="absolute top-0 origin-top-left transition-opacity duration-300"
        style={{
          width: SHEET_WIDTH,
          left: box?.left ?? 0,
          transform: `scale(${box?.scale ?? 0.5})`,
          opacity: box ? 1 : 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}
