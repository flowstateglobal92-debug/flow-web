"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Ambient motion behind the footer, confined to the empty right-hand block the
 * footer's column layout leaves open (roughly the right 45%, below the link
 * columns). It is deliberately desktop-only: at mobile widths the footer
 * collapses to one dense column with no free space, so there is nowhere to put
 * moving light without sitting under text.
 *
 * Loads only when the footer is near, never under `prefers-reduced-motion`, and
 * pauses whenever it is off-screen.
 */
export default function FooterBackdrop() {
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [load, setLoad] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    // Desktop only, and only when motion is welcome.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(min-width: 1024px)").matches) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setLoad(true);
        const v = video.current;
        if (!v) return;
        if (entry.isIntersecting) void v.play().catch(() => {});
        else v.pause();
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={wrap}
      aria-hidden
      className="pointer-events-none absolute inset-y-0 right-0 -z-10 hidden w-[52%] overflow-hidden lg:block"
    >
      {load && (
        <video
          ref={video}
          src="/art/footer-loop.mp4"
          muted
          loop
          playsInline
          autoPlay
          preload="metadata"
          disablePictureInPicture
          disableRemotePlayback
          tabIndex={-1}
          onCanPlay={() => setReady(true)}
          className={`absolute inset-0 h-full w-full object-cover object-right transition-opacity duration-1000 ${
                ready ? "opacity-100" : "opacity-0"
              }`}
          /* Two intersecting feathers keep the light inside the block the
             layout actually leaves empty: fading in from the left so it never
             crosses the link columns, and vertically windowed so it clears the
             walkthrough copy and button above and the legal row below.
             Measured: background luminance behind every text run stays at the
             page's own ~9, while the empty zone reads ~85. */
          style={{
            maskImage:
              "linear-gradient(to right, transparent 0%, rgba(0,0,0,0.5) 44%, #000 100%), linear-gradient(to bottom, transparent 0%, transparent 34%, rgba(0,0,0,0.45) 48%, #000 60%, #000 74%, transparent 90%)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent 0%, rgba(0,0,0,0.5) 44%, #000 100%), linear-gradient(to bottom, transparent 0%, transparent 34%, rgba(0,0,0,0.45) 48%, #000 60%, #000 74%, transparent 90%)",
            maskComposite: "intersect",
            WebkitMaskComposite: "source-in",
            opacity: 0.85,
          }}
        />
      )}
    </div>
  );
}
