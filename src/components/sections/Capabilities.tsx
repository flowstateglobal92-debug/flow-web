"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import ScrollReveal from "@/components/ScrollReveal";
import { Pill } from "@/components/os/ui";

type Group = "Acquire" | "Convert" | "Operate";

type Cap = {
  n: string;
  group: Group;
  title: string;
  desc: string;
  bullets: [string, string, string];
  img: string;
  w: number;
  h: number;
  span?: boolean;
};

const CAPS: Cap[] = [
  {
    n: "01",
    group: "Acquire",
    title: "WhatsApp AI sales representative",
    desc: "An autonomous first-response layer that keeps the conversation moving until a person is required.",
    bullets: [
      "24/7 replies in English, Sinhala and Tamil",
      "Live website review inside the chat",
      "Booking, reminders and contextual handoff",
    ],
    img: "/art/cap-whatsapp.webp",
    w: 774,
    h: 800,
    span: true,
  },
  {
    n: "02",
    group: "Acquire",
    title: "Automated lead hunter",
    desc: "A prospecting radar that finds businesses, detects digital weaknesses and drafts relevant outreach.",
    bullets: [
      "Search by city and industry",
      "Detect slow, missing or outdated sites",
      "Problem-specific outreach, deduplicated",
    ],
    img: "/art/cap-hunter.webp",
    w: 601,
    h: 800,
  },
  {
    n: "03",
    group: "Acquire",
    title: "AI content studio",
    desc: "Turn one topic into a complete, brand-matched social content package.",
    bullets: [
      "5–8 slide carousels from a single idea",
      "Headlines, body copy and hashtags",
      "Planning calendar and approvals",
    ],
    img: "/art/cap-content.webp",
    w: 700,
    h: 800,
  },
  {
    n: "04",
    group: "Convert",
    title: "Visual CRM and lead scoring",
    desc: "Every lead has a stage, a score and a next action — momentum you can see.",
    bullets: [
      "HOT / WARM / COLD buying signals",
      "Next-best action recommendations",
      "Complete history in one profile",
    ],
    img: "/art/cap-crm.webp",
    w: 800,
    h: 770,
  },
  {
    n: "05",
    group: "Convert",
    title: "Workflow automations",
    desc: "No-code playbooks: trigger, decision, action, ownership. Routine runs itself; exceptions come to people.",
    bullets: [
      "Instant response and keep-warm sequences",
      "Promise-based follow-up",
      "Escalation with clear ownership",
    ],
    img: "/art/cap-workflow.webp",
    w: 705,
    h: 800,
  },
  {
    n: "06",
    group: "Convert",
    title: "Digital proposals and e-sign",
    desc: "A private, mobile-friendly proposal the buyer can open, review and sign from anywhere.",
    bullets: [
      "Branded interactive quotation",
      "Live alert when it's opened",
      "Signature triggers onboarding",
    ],
    img: "/art/cap-esign.webp",
    w: 773,
    h: 800,
  },
  {
    n: "07",
    group: "Operate",
    title: "Financial operations",
    desc: "Invoices, instalments, cheques, margin and commissions — tracked next to the project, not in spreadsheets.",
    bullets: [
      "Branded PDFs with company seal",
      "Collection cadence with escalation",
      "Project margin and private commissions",
    ],
    img: "/art/cap-finance.webp",
    w: 699,
    h: 800,
    span: true,
  },
  {
    n: "08",
    group: "Operate",
    title: "Client portal and scheduler",
    desc: "A private branded link where clients see progress, deliverables and payments — and book time.",
    bullets: [
      "Milestones and progress percentage",
      "Payment history in one place",
      "Booking links with reminders",
    ],
    img: "/art/cap-portal.webp",
    w: 800,
    h: 714,
  },
  {
    n: "09",
    group: "Operate",
    title: "Voice and text copilot",
    desc: "Ask the business a question and get an action — it creates, updates and prepares.",
    bullets: [
      "“What are my top priorities today?”",
      "“Show unpaid invoices this month”",
      "“Prepare a project invoice draft”",
    ],
    img: "/art/cap-copilot.webp",
    w: 621,
    h: 800,
    span: true,
  },
];

const FILTERS: ("All" | Group)[] = ["All", "Acquire", "Convert", "Operate"];

function CapCard({ cap, dim }: { cap: Cap; dim: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState(true);

  useEffect(() => {
    // Tilt only for fine pointers; touch devices keep the card still.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pointer capability is only knowable on the client
    setTilt(
      window.matchMedia("(pointer: fine)").matches &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  }, []);

  const onMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      // `.spotlight::after` only lights up on `:hover`, which is itself gated to
      // fine pointers — so on a touch screen these writes fed a 420px radial
      // gradient nothing would ever show. The tilt was already gated behind
      // `tilt`; the custom-property writes were not, so a finger dragged across
      // a card still repainted it.
      if (!tilt) return;
      const node = el.current;
      if (!node) return;
      const r = node.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      node.style.setProperty("--mx", `${px * 100}%`);
      node.style.setProperty("--my", `${py * 100}%`);
      const rx = (0.5 - py) * 7;
      const ry = (px - 0.5) * 8;
      node.style.transform = `perspective(1100px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-3px)`;
    },
    [tilt],
  );

  const onLeave = useCallback(() => {
    const node = el.current;
    if (!node) return;
    node.style.transform = "";
  }, []);

  return (
    // Outer article is the ScrollReveal target (no CSS transitions here, so GSAP
    // owns opacity/transform cleanly); the inner surface handles tilt + dimming.
    <article data-cap className={`relative ${cap.span ? "lg:col-span-2" : ""}`}>
      <div
        ref={el}
        onPointerMove={tilt ? onMove : undefined}
        onPointerLeave={tilt ? onLeave : undefined}
        className={`glass spotlight group relative flex h-full min-h-[300px] flex-col overflow-hidden rounded-[26px] p-6 transition-[transform,opacity,filter] duration-500 ease-[var(--ease-flow)] will-change-transform sm:p-7 ${
          dim
            ? "pointer-events-none opacity-30 saturate-50 lg:scale-[0.985]"
            : "opacity-100"
        }`}
      >
        {/* Object */}
        <div
          className={`pointer-events-none absolute right-2 top-2 sm:right-3 sm:top-3 ${
            cap.span
              ? "w-[32%] max-w-[200px] sm:w-[36%] sm:max-w-[230px]"
              : "w-[36%] max-w-[145px] sm:w-[40%] sm:max-w-[165px]"
          }`}
          aria-hidden
        >
          <div className="glow-terra absolute left-1/2 top-1/2 h-[85%] w-[85%] -translate-x-1/2 -translate-y-1/2 opacity-45 transition-opacity duration-500 group-hover:opacity-75" />
          <Image
            src={cap.img}
            alt=""
            width={cap.w}
            height={cap.h}
            sizes="(min-width: 1024px) 230px, 40vw"
            className="float-y relative h-auto w-full object-contain drop-shadow-[0_16px_32px_rgba(0,0,0,0.6)] transition-transform duration-700 ease-[var(--ease-flow)] group-hover:scale-[1.04]"
            style={{ animationDelay: `${(parseInt(cap.n, 10) % 4) * -1.4}s` }}
          />
        </div>

        {/* Copy */}
        <div className="relative z-10 flex max-w-[58%] flex-wrap items-center gap-2 sm:max-w-none sm:gap-3">
          <span className="font-mono text-[11px] tracking-[0.2em] text-terra-bright">
            CAPABILITY {cap.n}
          </span>
          <Pill
            tone={
              cap.group === "Acquire"
                ? "terra"
                : cap.group === "Convert"
                  ? "cream"
                  : "neutral"
            }
          >
            {cap.group}
          </Pill>
        </div>
        <div
          className={`relative z-10 mt-auto pt-24 ${cap.span ? "max-w-md sm:pt-16" : "sm:pt-28"}`}
        >
          <h3 className="font-display text-xl font-medium leading-tight text-cream sm:text-[22px]">
            {cap.title}
          </h3>
          <p className="mt-2 text-pretty text-[13.5px] leading-relaxed text-cream-2">
            {cap.desc}
          </p>
          <ul className="mt-4 space-y-1.5">
            {cap.bullets.map((b) => (
              <li
                key={b}
                className="flex items-start gap-2 text-[12.5px] text-sand"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="mt-[3px] shrink-0 text-terra-bright"
                  aria-hidden
                >
                  <path
                    d="m5 12 4.5 4.5L19 7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}

export default function Capabilities() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");

  return (
    <section id="capabilities" className="relative scroll-mt-20 py-20 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="glow-terra absolute -left-40 top-40 h-[50vh] w-[50vh] opacity-30" />
        <div className="glow-cream absolute -right-40 bottom-20 h-[45vh] w-[45vh] opacity-25" />
      </div>

      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <ScrollReveal className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="eyebrow">Nine capabilities · one system</p>
            <h2 className="font-display mt-4 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl lg:text-6xl">
              Built as an operating layer,{" "}
              <span className="text-gradient">not another tool.</span>
            </h2>
            <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-cream-2 sm:text-lg">
              Nine business capabilities share one customer record, one
              automation engine and one command surface. We configure the mix
              for your business.
            </p>
          </div>

          <div
            className="flex flex-wrap gap-2"
            role="tablist"
            aria-label="Filter capabilities"
          >
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={`rounded-none border px-4 py-2 text-[13px] font-medium transition-all duration-300 ${
                  filter === f
                    ? "border-terra/50 bg-terra/15 text-terra-bright shadow-[0_0_24px_-8px_rgba(198,93,59,0.7)]"
                    : "border-cream/12 bg-cream/[0.03] text-cream-2 hover:border-cream/30 hover:text-cream"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </ScrollReveal>

        <ScrollReveal
          stagger="[data-cap]"
          y={40}
          className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-5"
        >
          {CAPS.map((c) => (
            <CapCard
              key={c.n}
              cap={c}
              dim={filter !== "All" && c.group !== filter}
            />
          ))}
        </ScrollReveal>

        {/* Shared foundation */}
        <ScrollReveal className="mt-14">
          <div className="hairline" />
          <div className="mt-8 flex flex-col items-start gap-6 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-[10px] uppercase tracking-[0.24em] text-sand">
              Shared foundation
            </p>
            <ul className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4 lg:max-w-3xl">
              {[
                "Customer data",
                "Automation rules",
                "Access control",
                "AI copilot",
              ].map((f, i) => (
                <li
                  key={f}
                  className="glass-inset flex items-center gap-3 px-4 py-3"
                >
                  <span className="font-mono text-[10px] text-terra-bright">
                    0{i + 1}
                  </span>
                  <span className="text-[12.5px] uppercase tracking-[0.12em] text-cream-2">
                    {f}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
