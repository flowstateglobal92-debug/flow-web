"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { gsap, useGSAP, ScrollTrigger, EASE } from "@/lib/gsap";
import ScrollReveal from "@/components/ScrollReveal";
import LiquidWordmark from "@/components/hero/LiquidWordmark";

type Step = {
  n: string;
  stage: string;
  title: string;
  desc: string;
  friction: string;
  solution: string;
  actions: string[];
  metric: string;
  metricLabel: string;
};

const STEPS: Step[] = [
  {
    n: "01",
    stage: "Inquiry",
    title: "Capture & Instant Qualification",
    desc: "Every inbound lead across WhatsApp, website forms, and email is acknowledged in under 35 seconds with conversational AI qualification in English, Sinhala or Tamil.",
    friction: "Slow response times outside office hours and lost inquiries",
    solution: "24/7 instant response · Inbound lead qualification · Direct calendar booking",
    actions: ["Inbound listener active 24/7", "AI audit & qualification run", "Calendar booking link sent"],
    metric: "< 35s",
    metricLabel: "Average first response time",
  },
  {
    n: "02",
    stage: "Opportunity",
    title: "Scoring & Frictionless Follow-Up",
    desc: "Leads are scored dynamically based on intent and audit findings. Automated follow-ups run on precise cadences without depending on human memory.",
    friction: "Deals stalling in inboxes and forgotten follow-up cadences",
    solution: "Automated scoring · Personalized audit review · Scheduled reminders",
    actions: ["Lead score calculated instantly", "Audit report dispatched", "CRM pipeline card updated"],
    metric: "3.4×",
    metricLabel: "Higher follow-up completion",
  },
  {
    n: "03",
    stage: "Agreement",
    title: "Dynamic Proposals & Fast Sign-off",
    desc: "Proposals and scope quotes are generated automatically from qualified discovery context. Live view tracking alerts you the moment a client opens the deck.",
    friction: "Proposals that stall after sending with zero visibility",
    solution: "Instant document assembly · Live open alerts · One-click digital sign",
    actions: ["Dynamic scope & quote compiled", "Proposal view alerts triggered", "Digital agreement dispatched"],
    metric: "48 hrs",
    metricLabel: "Average turnaround to sign",
  },
  {
    n: "04",
    stage: "Delivery",
    title: "Post-Signature Orchestration",
    desc: "The moment a contract is signed, the system creates the project workspace, migrates all sales notes, alerts the delivery team, and queues onboarding tasks.",
    friction: "Repeated handoffs, miscommunication, and manual data re-entry",
    solution: "One-signature kickoff · Team task assignment · Zero re-keying",
    actions: ["Project workspace created", "Milestones & client context synced", "Team kickoff tasks assigned"],
    metric: "0 min",
    metricLabel: "Duplicate data entry required",
  },
  {
    n: "05",
    stage: "Cash",
    title: "Automated Invoicing & Collection",
    desc: "Deposit invoices with secure payment links are issued immediately upon signature. Automated collection cadences ensure fast cash reconciliation with zero awkward chasing.",
    friction: "Delayed invoicing and uncomfortable manual debt follow-up",
    solution: "Instant deposit links · Automated friendly cadences · Bank reconciliation",
    actions: ["Deposit invoice generated", "WhatsApp payment link sent", "Automated payment reconciliation"],
    metric: "94%",
    metricLabel: "On-time invoice collection rate",
  },
];

const STATS = [
  ["Availability", "24/7", "Inbound coverage"],
  ["Context", "One view", "Shared customer history"],
  ["Execution", "Automated", "Repeatable workflows"],
  ["Oversight", "Visible", "Pipeline to cash flow"],
];

const INTRO =
  "Growth should create more revenue — not more administrative drag. One control layer connects sales, client communication, delivery and finance into a seamless fluid continuum.";

/* ────────────────────────────────────────────────────────────────────────────
   Scroll-scrubbed fill video. Higgsfield (Seedance 2.0) render of the glass
   pipeline filling with light, upscaled to 4K with Topaz and encoded with a
   keyframe every 6 frames so `currentTime` seeks are instant. The ring
   centres and the moment the liquid reaches each ring were measured with
   assets/video-src/extract_frames.py.
   ──────────────────────────────────────────────────────────────────────────── */
const VIDEO = {
  duration: 7.04,
  /** Second at which the liquid reaches each checkpoint ring. */
  arrive: [2.12, 3.29, 4.25, 4.96, 5.92],
  /** Liquid reaches the right edge; the rest is a slow colour settle. */
  full: 6.21,
  /** Visual centre line of the tube in frame space (0–1). */
  tubeY: 0.495,
};
/** Checkpoint ring centres in frame space (0–1). */
const RINGS = [
  { x: 0.095, y: 0.4213 },
  { x: 0.3486, y: 0.4926 },
  { x: 0.5778, y: 0.4991 },
  { x: 0.7333, y: 0.5444 },
  { x: 0.9134, y: 0.5167 },
];
/** Encoded tiers; picked from the stage's real device-pixel width. */
const TIERS = [
  { w: 1280, src: "/cycle/fill-720.mp4" },
  { w: 1920, src: "/cycle/fill-1080.mp4" },
  { w: 2560, src: "/cycle/fill-1440.mp4" },
];
const POSTER_EMPTY = "/cycle/poster-empty.webp";
const POSTER_FULL = "/cycle/poster-full.webp";
/** Scroll length of one stage on desktop, as a fraction of the viewport height. */
const STAGE_VH = 0.9;

function pickTier(devicePx: number) {
  return TIERS.find((t) => t.w >= devicePx * 0.85) ?? TIERS[TIERS.length - 1];
}

/** Piecewise-linear scroll(px) → video time map. */
type Track = { pts: Array<[number, number]>; arrive: number[] };

function timeAt(track: Track, y: number): number {
  const { pts } = track;
  if (y <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [y0, t0] = pts[i - 1];
    const [y1, t1] = pts[i];
    if (y <= y1) return y1 === y0 ? t1 : t0 + ((y - y0) / (y1 - y0)) * (t1 - t0);
  }
  return pts[pts.length - 1][1];
}

function activeAt(track: Track, y: number): number {
  let idx = -1;
  for (let i = 0; i < track.arrive.length; i++) if (y >= track.arrive[i]) idx = i;
  return idx;
}

/**
 * Fit the 16:9 frame to the full stage width (the tube must always span edge
 * to edge), then slide it vertically so the tube's centre line sits at
 * `targetY` of the stage. Never expose a gap when the frame is taller than
 * the stage; when it is shorter the CSS mask hides the seams.
 */
function fitRect(cw: number, ch: number, targetY: number) {
  const dw = cw;
  const dh = (cw * 9) / 16;
  let dy = targetY * ch - VIDEO.tubeY * dh;
  if (dh >= ch) dy = Math.min(0, Math.max(ch - dh, dy));
  return { dy, dw, dh };
}

function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

type Layout = {
  dy: number;
  dw: number;
  dh: number;
  markers: Array<{ x: number; y: number }>;
  labelOffset: number;
};

export default function RevenueCycle() {
  const root = useRef<HTMLElement>(null);
  const pinBox = useRef<HTMLDivElement>(null);
  const stageEl = useRef<HTMLDivElement>(null);
  const videoEl = useRef<HTMLVideoElement>(null);
  const articleEls = useRef<Array<HTMLElement | null>>([]);

  const track = useRef<Track | null>(null);
  const targetT = useRef(0); // where the scroll says the video should be
  const currentT = useRef(0); // where the eased playhead is
  const tierW = useRef(0); // width of the tier currently loaded (0 = none)
  const wantLoad = useRef(false); // section is close enough to start loading

  const motionOk = useMedia("(prefers-reduced-motion: no-preference)");
  const wide = useMedia("(min-width: 1024px)");
  const pin = motionOk && wide;

  const [active, setActive] = useState(-1);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  /* ── Video source: pick the tier for the stage's device pixels, load once ── */
  const ensureSource = useCallback(() => {
    const v = videoEl.current;
    const stage = stageEl.current;
    if (!v || !stage || !wantLoad.current) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const tier = pickTier(stage.clientWidth * dpr);
    // Only ever step up (a bigger stage later), never re-download a smaller one.
    if (tier.w <= tierW.current) return;
    tierW.current = tier.w;
    setVideoReady(false);
    v.src = tier.src;
    v.load();
  }, []);

  useEffect(() => {
    const v = videoEl.current;
    if (!v) return;
    let cancelled = false;
    const onLoaded = () => {
      // Wake the media pipeline (muted + playsinline is allowed everywhere),
      // then park on the current target and reveal once that frame is painted.
      const park = () => {
        if (cancelled) return;
        v.pause();
        currentT.current = targetT.current;
        const onSeeked = () => {
          v.removeEventListener("seeked", onSeeked);
          if (!cancelled) setVideoReady(true);
        };
        v.addEventListener("seeked", onSeeked);
        v.currentTime = Math.max(0.001, targetT.current);
      };
      const p = v.play();
      if (p && typeof p.then === "function") p.then(park, park);
      else park();
    };
    const onError = () => {
      if (!cancelled) setVideoFailed(true);
    };
    v.addEventListener("loadeddata", onLoaded);
    v.addEventListener("error", onError);
    return () => {
      cancelled = true;
      v.removeEventListener("loadeddata", onLoaded);
      v.removeEventListener("error", onError);
    };
  }, []);

  /* ── Eased playhead: scroll sets the target, the ticker seeks toward it,
        ultra-fluid, high-responsiveness playback ─────── */
  useEffect(() => {
    if (!motionOk) return;
    const tick = () => {
      const v = videoEl.current;
      if (!v || v.readyState < 2) return;
      const target = targetT.current;
      let cur = currentT.current;
      const diff = target - cur;
      if (Math.abs(diff) < 0.001) return;
      
      // High-speed fluid interpolation: tracks scroll immediately without lag
      const k = 1 - Math.pow(0.1, gsap.ticker.deltaRatio(60));
      cur = Math.abs(diff) < 0.006 ? target : cur + diff * k;
      currentT.current = cur;
      v.currentTime = cur;
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [motionOk]);

  /* ── Geometry: fit the frame to the stage, place the node labels ─────── */
  useEffect(() => {
    const stage = stageEl.current;
    if (!stage) return;
    const measure = () => {
      const cw = stage.clientWidth;
      const ch = stage.clientHeight;
      if (!cw || !ch) return;
      const r = fitRect(cw, ch, pin ? 0.49 : 0.5);
      setLayout({
        ...r,
        markers: RINGS.map((k) => ({ x: k.x * r.dw, y: r.dy + k.y * r.dh })),
        labelOffset: Math.max(20, r.dh * 0.062),
      });
      ensureSource();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [pin, ensureSource]);

  /* ── Scroll choreography ─────────────────────────────────────────────── */
  useGSAP(
    () => {
      const rootEl = root.current;
      if (!rootEl) return;

      if (!motionOk) {
        setActive(STEPS.length - 1);
        return;
      }

      // Start fetching the video well before the section shows.
      ScrollTrigger.create({
        trigger: rootEl,
        start: "top bottom+=150%",
        once: true,
        onEnter: () => {
          wantLoad.current = true;
          ensureSource();
        },
      });

      // Header entrance (children only — never transform the pinned box itself).
      gsap.from("[data-cycle-head] > *", {
        y: 22,
        opacity: 0,
        duration: 0.9,
        stagger: 0.08,
        ease: EASE.out,
        scrollTrigger: { trigger: rootEl, start: "top 78%", once: true },
      });

      const update = (self: ScrollTrigger) => {
        const t = track.current;
        if (!t) return;
        const y = self.scroll();
        targetT.current = timeAt(t, y);
        setActive(activeAt(t, y));
      };

      if (pin) {
        const box = pinBox.current!;
        const unit = () => window.innerHeight * STAGE_VH;
        const st = ScrollTrigger.create({
          trigger: box,
          start: "top top",
          end: () => "+=" + Math.round(unit() * (STEPS.length + 0.6)),
          pin: true,
          pinSpacing: true,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onRefresh: (self) => {
            const u = unit();
            const S = self.start;
            const arrive = RINGS.map((_, i) => S + u * (0.45 + i));
            const pts: Array<[number, number]> = [
              [S, 0],
              ...VIDEO.arrive.map((t, i): [number, number] => [arrive[i], t]),
              [arrive[RINGS.length - 1] + u * 0.45, VIDEO.full],
              [self.end, VIDEO.duration],
            ];
            track.current = { pts, arrive };
            update(self);
          },
          onUpdate: update,
        });
        // The pin adds a spacer; make sure everything below re-measures.
        requestAnimationFrame(() => ScrollTrigger.refresh());
        return () => st.kill();
      }

      // Flow mode (phones/tablets): the band sticks under the nav and fills as
      // each stage card reaches the reading line.
      const box = pinBox.current!;
      const st = ScrollTrigger.create({
        trigger: box,
        start: "top bottom",
        end: "bottom top",
        invalidateOnRefresh: true,
        onRefresh: (self) => {
          const vh = window.innerHeight;
          const scrollY = self.scroll();
          const arrive = articleEls.current.map((el) => {
            if (!el) return self.start;
            const top = el.getBoundingClientRect().top + scrollY;
            return top - vh * 0.55;
          });
          const first = arrive[0];
          const last = arrive[arrive.length - 1];
          const pts: Array<[number, number]> = [
            [first - vh * 0.5, 0],
            ...VIDEO.arrive.map((t, i): [number, number] => [arrive[i], t]),
            [last + vh * 0.5, VIDEO.full],
            [Math.max(last + vh * 0.9, self.end - vh), VIDEO.duration],
          ];
          track.current = { pts, arrive };
          update(self);
        },
        onUpdate: update,
      });
      return () => st.kill();
    },
    { scope: root, dependencies: [pin, motionOk, ensureSource], revertOnUpdate: true },
  );

  const counter = String(Math.max(0, active + 1)).padStart(2, "0");
  const showVideo = motionOk && videoReady && !videoFailed;
  const posterSrc = motionOk && !videoFailed ? POSTER_EMPTY : POSTER_FULL;

  /* ── Pieces ──────────────────────────────────────────────────────────── */
  const header = (
    <div data-cycle-head className={pin ? "max-w-2xl" : "max-w-3xl"}>
      <p className="eyebrow">One continuous operating flow</p>
      <h2
        className={cx(
          "font-display mt-4 text-balance font-medium leading-[1.05] text-cream",
          pin ? "text-[2.5rem] xl:text-5xl" : "text-4xl sm:text-5xl",
        )}
      >
        From first inquiry to final payment,{" "}
        <span className="inline-flex flex-wrap items-baseline gap-x-[0.2em] gap-y-[0.15em]">
          <span className="mr-1">one</span>
          <LiquidWordmark word="flow" />
          <span>.</span>
        </span>
      </h2>
      {!pin && (
        <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-cream-2 sm:text-lg">
          {INTRO}
        </p>
      )}
    </div>
  );

  const frameStyle = layout
    ? { top: layout.dy, width: layout.dw, height: layout.dh }
    : undefined;

  const nodeLabels = layout && (
    <div className="pointer-events-none absolute inset-0">
      {STEPS.map((s, i) => {
        const p = layout.markers[i];
        const state = i < active ? "passed" : i === active ? "active" : "idle";
        return (
          <div
            key={s.n}
            style={{ left: p.x, top: p.y }}
            className="absolute -translate-x-1/2 -translate-y-1/2"
          >
            {/* Clean stage text label (no circular outline) */}
            <span
              style={{ transform: `translate(-50%, ${layout.labelOffset}px)` }}
              className={cx(
                "absolute left-1/2 top-1/2 flex items-center gap-1.5 whitespace-nowrap font-mono text-[10px] tracking-[0.16em] transition-colors duration-500 sm:text-[11px]",
                state === "active" ? "text-cream font-medium" : state === "passed" ? "text-cream-2" : "text-sand/75",
              )}
            >
              <span
                className={cx(
                  "h-1.5 w-1.5 rounded-full transition-colors duration-500",
                  state === "active" ? "pulse-dot bg-terra-bright" : state === "passed" ? "bg-terra/70" : "bg-cream/25",
                )}
              />
              <span>{s.n}</span>
              <span className="hidden sm:inline">{s.stage}</span>
            </span>
          </div>
        );
      })}
    </div>
  );

  const stackClass = (on: boolean) =>
    cx(
      "col-start-1 row-start-1 transition-[opacity,transform] duration-500 [transition-timing-function:var(--ease-flow)]",
      on ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
    );

  return (
    <section id="cycle" ref={root} className="relative scroll-mt-20">
      {/* Ambient glows */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="glow-terra absolute -left-48 top-1/3 h-[50vh] w-[50vh] opacity-20" />
        <div className="glow-terra absolute -right-48 bottom-1/4 h-[50vh] w-[50vh] opacity-15" />
      </div>

      {!pin && (
        <div className="mx-auto max-w-7xl px-4 pt-20 sm:px-8 sm:pt-28">
          <ScrollReveal>{header}</ScrollReveal>
        </div>
      )}

      {/* ─── The chapter: pinned full-viewport on desktop, sticky band + cards below ─── */}
      <div
        ref={pinBox}
        className={pin ? "relative h-[100svh] min-h-[640px]" : "relative mt-8 sm:mt-10"}
      >
        {/* Video layer */}
        <div
          ref={stageEl}
          className={cx(
            "overflow-hidden",
            pin
              ? "absolute inset-0"
              : "sticky top-[var(--nav-h)] z-10 h-[58vw] max-h-[440px] bg-ink",
          )}
        >
          <div className="absolute inset-0 [mask-image:linear-gradient(to_bottom,transparent,#000_16%,#000_84%,transparent)]">
            {/* Poster: the empty pipeline until the video has painted its first frame */}
            {/* eslint-disable-next-line @next/next/no-img-element -- fixed-geometry poster under a video */}
            <img
              src={posterSrc}
              alt=""
              aria-hidden
              decoding="async"
              style={frameStyle}
              className={cx(
                "absolute left-0 max-w-none transition-opacity duration-700",
                showVideo ? "opacity-0" : "opacity-100",
              )}
            />
            <video
              ref={videoEl}
              muted
              playsInline
              preload="auto"
              disablePictureInPicture
              disableRemotePlayback
              aria-hidden
              tabIndex={-1}
              style={frameStyle}
              className={cx(
                "absolute left-0 max-w-none transition-opacity duration-700",
                showVideo ? "opacity-100" : "opacity-0",
              )}
            />
          </div>
          {/* Grounding: soften the edges into the page */}
          <div
            className={cx(
              "pointer-events-none absolute inset-0 bg-gradient-to-r from-ink/60 via-transparent to-ink/60",
              !pin && "opacity-70",
            )}
          />
          {nodeLabels}
        </div>

        {pin ? (
          <div className="relative mx-auto flex h-full max-w-7xl flex-col px-6 pb-8 pt-[calc(var(--nav-h)+1.6rem)] sm:px-8 xl:pb-10">
            {/* Top band: heading + live counter */}
            <div className="flex items-start justify-between gap-8">
              {header}
              <div className="shrink-0 pt-1 text-right">
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-sand">
                  Live automated pipeline
                </p>
                <p className="font-display mt-1 text-3xl tabular-nums text-cream">
                  {counter}
                  <span className="text-sand"> / 05</span>
                </p>
              </div>
            </div>

            {/* Bottom band: the checkpoint's story, revealed as the liquid arrives */}
            <div className="mt-auto grid grid-cols-[minmax(0,1fr)_300px] items-end gap-10 xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-14">
              <div className="grid">
                <div className={stackClass(active < 0)} aria-hidden={active >= 0}>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-sand">
                    Live automated pipeline · five checkpoints
                  </p>
                  <p className="mt-3 max-w-xl text-pretty text-base leading-relaxed text-cream-2 xl:text-lg">
                    {INTRO}
                  </p>
                </div>
                {STEPS.map((s, i) => (
                  <article key={s.n} className={stackClass(active === i)} aria-hidden={active !== i}>
                    <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-terra-bright">
                      Stage {s.n} of 05 · {s.stage}
                    </p>
                    <h3 className="font-display mt-2 text-3xl font-medium leading-tight text-cream xl:text-4xl">
                      {s.title}
                    </h3>
                    <p className="mt-3 max-w-xl text-pretty text-[15px] leading-relaxed text-cream-2 xl:text-base">
                      {s.desc}
                    </p>
                    <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
                      {s.actions.map((act) => (
                        <li key={act} className="flex items-center gap-2 text-[12.5px] text-cream">
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center bg-terra/20 text-[10px] text-terra-bright ring-1 ring-terra/30">
                            ✓
                          </span>
                          {act}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>

              <div className="grid">
                <div className={stackClass(active < 0)} aria-hidden={active >= 0}>
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-sand">Checkpoints</p>
                  <ol className="mt-3 space-y-2">
                    {STEPS.map((s) => (
                      <li key={s.n} className="flex items-baseline gap-3 font-mono text-[12px] tracking-wider text-cream-2">
                        <span className="text-terra-bright/80">{s.n}</span>
                        <span>{s.stage}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                {STEPS.map((s, i) => (
                  <div key={s.n} className={stackClass(active === i)} aria-hidden={active !== i}>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-sand">Measurable outcome</p>
                    <p className="font-display mt-1 text-4xl font-medium tabular-nums text-cream xl:text-5xl">
                      {s.metric}
                    </p>
                    <p className="mt-1 text-[12px] text-sand">{s.metricLabel}</p>
                    <div className="mt-4 border-t border-cream/10 pt-3">
                      <p className="text-[12px] leading-snug text-sand line-through decoration-terra-bright/60">
                        {s.friction}
                      </p>
                      <p className="mt-1.5 text-[12.5px] font-medium leading-snug text-cream">{s.solution}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="relative mx-auto max-w-7xl px-4 sm:px-8">
            <ol className="mx-auto max-w-2xl lg:max-w-3xl">
              {STEPS.map((s, i) => {
                const on = i <= active;
                return (
                  <li
                    key={s.n}
                    ref={(el) => {
                      articleEls.current[i] = el;
                    }}
                    className="border-t border-cream/10 py-10 first:border-t-0 first:pt-8 sm:py-12"
                  >
                    <article
                      className={cx(
                        "transition-opacity duration-500",
                        motionOk && !on ? "opacity-70" : "opacity-100",
                      )}
                    >
                      <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-terra-bright">
                        <span
                          className={cx(
                            "h-1.5 w-1.5 rounded-full",
                            i === active ? "pulse-dot bg-terra-bright" : on ? "bg-terra/70" : "bg-cream/25",
                          )}
                        />
                        Stage {s.n} of 05 · {s.stage}
                      </p>
                      <h3 className="font-display mt-3 text-2xl font-medium leading-tight text-cream sm:text-3xl">
                        {s.title}
                      </h3>
                      <p className="mt-3 text-pretty text-[15px] leading-relaxed text-cream-2 sm:text-base">
                        {s.desc}
                      </p>
                      <ul className="mt-4 space-y-2">
                        {s.actions.map((act) => (
                          <li key={act} className="flex items-center gap-2.5 text-[13px] text-cream">
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center bg-terra/20 text-[10px] text-terra-bright ring-1 ring-terra/30">
                              ✓
                            </span>
                            {act}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-6 border-t border-cream/10 pt-4">
                        <div>
                          <p className="text-[12px] leading-snug text-sand line-through decoration-terra-bright/60">
                            {s.friction}
                          </p>
                          <p className="mt-1.5 text-[12.5px] font-medium leading-snug text-cream">{s.solution}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-display text-3xl font-medium tabular-nums text-cream">{s.metric}</p>
                          <p className="mt-0.5 max-w-[9rem] text-[11px] leading-snug text-sand">{s.metricLabel}</p>
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>

      {/* Bottom stat strip */}
      <div className="mx-auto max-w-7xl px-4 pb-20 pt-14 sm:px-8 sm:pb-28 sm:pt-20">
        <ScrollReveal stagger="[data-stat]" className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
          {STATS.map(([label, big, small]) => (
            <div key={label} data-stat className="border-l border-cream/10 pl-5">
              <p className="text-[10px] uppercase tracking-[0.2em] text-sand">{label}</p>
              <p className="font-display mt-2 text-2xl text-cream sm:text-3xl">{big}</p>
              <p className="mt-1 text-[13px] text-cream-2">{small}</p>
            </div>
          ))}
        </ScrollReveal>
      </div>
    </section>
  );
}
