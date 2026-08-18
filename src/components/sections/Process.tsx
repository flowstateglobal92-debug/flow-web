"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { gsap, useGSAP, ScrollTrigger } from "@/lib/gsap";
import ScrollReveal from "@/components/ScrollReveal";
import GlassIcon from "@/components/GlassIcon";

/* ───────────── Data ───────────── */
type Step = {
  n: string;
  icon: string;
  title: string;
  desc: string;
  when: string;
  detail: string;
};

const STEPS: Step[] = [
  {
    n: "01",
    icon: "ic-map",
    title: "Map",
    desc: "Identify repeat work, delays and revenue leaks.",
    when: "Week 1",
    detail: "We walk your week end to end and mark every step a person repeats.",
  },
  {
    n: "02",
    icon: "ic-configure",
    title: "Configure",
    desc: "Set roles, pipeline, rules and templates.",
    when: "Weeks 1–2",
    detail: "Your stages, your approvals, your language — written as readable rules.",
  },
  {
    n: "03",
    icon: "ic-connect",
    title: "Connect",
    desc: "Link channels, calendar and operating data.",
    when: "Week 2",
    detail: "WhatsApp, forms, calendar and money move onto one shared record.",
  },
  {
    n: "04",
    icon: "ic-optimize",
    title: "Optimize",
    desc: "Review outcomes and expand automation.",
    when: "Ongoing",
    detail: "We read the hours and cash recovered, tune the rules, then widen the net.",
  },
];

/* ───────────── Rail geometry ─────────────
   The path is built from the measured centre of each node so the curve always
   passes exactly through them, at any breakpoint. It bows alternately left and
   right between nodes so the journey reads as a flow rather than a ruler. */
const RAIL_W = 72;
const CX = RAIL_W / 2;
const BOW = 19;

type Geom = { h: number; d: string; nodes: number[] };

function buildPath(nodes: number[], h: number): string {
  if (!nodes.length) return "";
  let d = `M ${CX} 0 L ${CX} ${nodes[0].toFixed(1)}`;
  for (let i = 0; i < nodes.length - 1; i++) {
    const y0 = nodes[i];
    const y1 = nodes[i + 1];
    const span = y1 - y0;
    const b = CX + (i % 2 === 0 ? BOW : -BOW);
    d += ` C ${b} ${(y0 + span * 0.3).toFixed(1)}, ${b} ${(y0 + span * 0.7).toFixed(1)}, ${CX} ${y1.toFixed(1)}`;
  }
  d += ` L ${CX} ${h.toFixed(1)}`;
  return d;
}

/* ───────────── Section ───────────── */
export default function Process() {
  const list = useRef<HTMLOListElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const glowRef = useRef<SVGPathElement>(null);
  const comet = useRef<SVGGElement>(null);

  const [geom, setGeom] = useState<Geom | null>(null);
  const [active, setActive] = useState(-1);
  const activeRef = useRef(-1);

  /* Measure the rail from the real node positions, and re-measure on resize. */
  const measure = useCallback(() => {
    const el = list.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const anchors = Array.from(el.querySelectorAll<HTMLElement>("[data-node]"));
    if (!anchors.length) return;
    const nodes = anchors.map((a) => {
      const r = a.getBoundingClientRect();
      return r.top - box.top + r.height / 2;
    });
    setGeom({ h: box.height, nodes, d: buildPath(nodes, box.height) });
  }, []);

  useEffect(() => {
    measure();
    const el = list.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  /* Draw the rail against scroll; the comet rides the tip and lights each node. */
  useGSAP(
    () => {
      const path = pathRef.current;
      const glow = glowRef.current;
      if (!path || !geom) return;

      const setActiveIndex = (i: number) => {
        if (activeRef.current === i) return;
        activeRef.current = i;
        setActive(i);
      };

      const mm = gsap.matchMedia();

      // Reduced motion: the whole journey is simply already drawn.
      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set([path, glow], { strokeDashoffset: 0 });
        gsap.set(comet.current, { autoAlpha: 0 });
        setActiveIndex(STEPS.length - 1);
      });

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const len = path.getTotalLength();
        gsap.set([path, glow], { strokeDasharray: len, strokeDashoffset: len });
        gsap.set(comet.current, { autoAlpha: 0 });

        const st = ScrollTrigger.create({
          trigger: list.current,
          start: "top 68%",
          end: "bottom 62%",
          scrub: 0.5,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            const p = self.progress;
            const drawn = len * p;
            gsap.set([path, glow], { strokeDashoffset: len - drawn });

            // The tip of the drawn line — the comet sits on it.
            const pt = path.getPointAtLength(drawn);
            gsap.set(comet.current, {
              x: pt.x,
              y: pt.y,
              autoAlpha: p > 0.001 && p < 0.999 ? 1 : 0,
            });

            // A node counts as reached once the tip has passed its y.
            let idx = -1;
            for (let i = 0; i < geom.nodes.length; i++) {
              if (pt.y >= geom.nodes[i] - 2) idx = i;
            }
            setActiveIndex(idx);
          },
        });
        return () => st.kill();
      });

      return () => mm.revert();
    },
    { dependencies: [geom], revertOnUpdate: true },
  );

  const counter = String(Math.max(0, active + 1)).padStart(2, "0");

  return (
    <section id="process" className="relative scroll-mt-20 py-20 sm:py-28">
      {/* Ambient */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="glow-cream absolute -left-40 top-1/4 h-[40vh] w-[40vh] opacity-20" />
        <div className="glow-terra absolute -right-40 bottom-1/4 h-[45vh] w-[45vh] opacity-25" />
      </div>

      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <ScrollReveal className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="eyebrow">Our process · Four steps</p>
            <h2 className="font-display mt-4 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl lg:text-6xl">
              Start with the work that <span className="text-gradient">slows growth down.</span>
            </h2>
            <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-cream-2 sm:text-lg">
              A focused rollout turns the highest-friction work into reusable, measurable operating
              playbooks. Custom to your business — not a template.
            </p>
          </div>
          {/* Live position in the journey */}
          <div className="shrink-0 lg:text-right">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-sand">Rollout step</p>
            <p className="font-display mt-1 text-3xl tabular-nums text-cream">
              {counter}
              <span className="text-sand"> / 04</span>
            </p>
          </div>
        </ScrollReveal>

        {/* ─── The journey ─── */}
        <ol ref={list} className="relative mt-14 sm:mt-20">
          {/* Rail: left of the cards on mobile, down the centre on desktop */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 h-full w-[72px] [mask-image:linear-gradient(to_bottom,transparent,#000_5%,#000_95%,transparent)] lg:left-1/2 lg:-translate-x-1/2"
          >
            {geom && (
              <svg
                width={RAIL_W}
                height={geom.h}
                viewBox={`0 0 ${RAIL_W} ${geom.h}`}
                fill="none"
                className="overflow-visible"
              >
                <defs>
                  <linearGradient id="fs-rail" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#c65d3b" />
                    <stop offset="0.5" stopColor="#e0784f" />
                    <stop offset="1" stopColor="#f3e9dc" />
                  </linearGradient>
                </defs>

                {/* Track: the whole journey, faint */}
                <path d={geom.d} stroke="rgba(243,233,220,0.10)" strokeWidth="1.5" strokeLinecap="round" />

                {/* Bloom under the drawn line */}
                <path
                  ref={glowRef}
                  d={geom.d}
                  stroke="url(#fs-rail)"
                  strokeWidth="7"
                  strokeLinecap="round"
                  opacity="0.3"
                  style={{ filter: "blur(6px)" }}
                />
                {/* The drawn line itself */}
                <path
                  ref={pathRef}
                  d={geom.d}
                  stroke="url(#fs-rail)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />

                {/* Comet riding the tip */}
                <g ref={comet}>
                  <circle r="9" fill="rgba(224,120,79,0.35)" style={{ filter: "blur(5px)" }} />
                  <circle r="3.2" fill="#ffd9c4" />
                </g>
              </svg>
            )}
          </div>

          {STEPS.map((s, i) => {
            const left = i % 2 === 0;
            const reached = i <= active;
            return (
              <li
                key={s.n}
                className="relative grid grid-cols-[72px_minmax(0,1fr)] items-center pb-10 last:pb-0 sm:pb-12 lg:grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] lg:pb-14"
              >
                {/* Node — the anchor the rail is measured from */}
                <span
                  data-node
                  className="relative col-start-1 row-start-1 flex h-[72px] w-[72px] items-center justify-center lg:col-start-2"
                >
                  <span
                    className={`absolute h-11 w-11 rounded-full bg-terra/20 blur-md transition-opacity duration-700 ${
                      reached ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <span
                    className={`relative flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-ink transition-colors duration-500 ${
                      reached ? "bg-terra-bright" : "bg-cream/20"
                    }`}
                  >
                    <span
                      className={`h-4 w-4 rounded-full ${i === active ? "pulse-dot" : ""}`}
                    />
                  </span>
                </span>

                {/* Card */}
                <div
                  className={`col-start-2 row-start-1 transition-[opacity,transform,filter] duration-700 ease-[var(--ease-flow)] ${
                    reached ? "translate-y-0 opacity-100 blur-0" : "translate-y-4 opacity-30 blur-[1px]"
                  } ${left ? "lg:col-start-1 lg:pr-12" : "lg:col-start-3 lg:pl-12"}`}
                >
                  <article className="group glass spotlight relative overflow-hidden rounded-2xl p-5 transition-[border-color,box-shadow] duration-500 hover:border-cream/25 hover:shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85),0_0_0_1px_rgba(198,93,59,0.15)] sm:p-6">
                    <div className="flex items-start justify-between gap-4">
                      <GlassIcon name={s.icon} size={64} delay={i * -1.5} />
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-terra-bright">
                        {s.n}
                      </span>
                    </div>

                    <h3 className="font-display mt-5 text-xl font-medium text-cream sm:text-2xl">{s.title}</h3>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-cream-2">{s.desc}</p>
                    <p className="mt-2 text-[12.5px] leading-relaxed text-sand">{s.detail}</p>

                    <div className="mt-5 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-cream/[0.04] px-2.5 py-1 font-mono text-[10.5px] tracking-[0.08em] text-sand ring-1 ring-cream/10">
                        <span
                          className={`h-1 w-1 rounded-full ${
                            i === STEPS.length - 1 ? "bg-emerald-300" : "bg-terra"
                          }`}
                        />
                        {s.when}
                      </span>
                    </div>
                  </article>
                </div>
              </li>
            );
          })}
        </ol>

        {/* Principle */}
        <ScrollReveal className="mt-12 flex flex-col gap-3 border-t border-cream/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] text-sand">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-terra-bright">Principle</span>
            <span className="mx-3 text-cream/20">·</span>
            Routine steps run automatically. Approvals and exceptions stay human-owned.
          </p>
          <Link
            href="/contact"
            className="group inline-flex items-center gap-2 text-[13px] text-cream-2 transition-colors hover:text-cream"
          >
            Map your first three automations
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
              className="transition-transform duration-300 group-hover:translate-x-0.5"
            >
              <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </ScrollReveal>
      </div>
    </section>
  );
}
