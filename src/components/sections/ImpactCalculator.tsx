"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import ScrollReveal from "@/components/ScrollReveal";
import { Icon, Pill } from "@/components/os/ui";

/* ───────────── Inputs ───────────── */
type SliderDef = {
  key: "actions" | "minutes" | "rate";
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
};

const SLIDERS: SliderDef[] = [
  {
    key: "actions",
    label: "Repeat actions per month",
    hint: "Replies, reminders, updates, invoices, handoffs.",
    min: 50,
    max: 2000,
    step: 10,
    format: (v) => v.toLocaleString("en-US"),
  },
  {
    key: "minutes",
    label: "Minutes saved per action",
    hint: "Typical routine step, start to finish.",
    min: 2,
    max: 30,
    step: 1,
    format: (v) => `${v} min`,
  },
  {
    key: "rate",
    label: "Loaded hourly cost of the person doing it",
    hint: "Salary plus overheads, per hour.",
    min: 5,
    max: 150,
    step: 1,
    format: (v) => `Rs ${v}/h`,
  },
];

const DEFAULTS = { actions: 300, minutes: 8, rate: 25 };
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
/* Bars saturate at this many hours/month — beyond it the visual is simply "full". */
const BAR_CAP_HOURS = 320;

const EASE_OUT = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Tweens a number toward `target` with requestAnimationFrame each time it
 * changes. Returns the in-flight value for rendering.
 */
function useTweened(target: number, duration = 520) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const current = useRef(target);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    // Reduced motion: still tween through rAF, but land on the first frame.
    const ms = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : duration;
    from.current = current.current;
    const start = performance.now();
    const step = (now: number) => {
      const t = ms === 0 ? 1 : Math.min(1, (now - start) / ms);
      const v = from.current + (target - from.current) * EASE_OUT(t);
      current.current = v;
      setValue(v);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, duration]);

  return value;
}

const fmtHours = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtDays = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtMoney = (n: number) => "Rs " + Math.round(n).toLocaleString("en-US");

/* ───────────── Pieces ───────────── */
function Slider({
  def,
  value,
  onChange,
}: {
  def: SliderDef;
  value: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const pct = ((value - def.min) / (def.max - def.min)) * 100;
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <label htmlFor={id} className="min-w-0">
          <span className="block text-[13px] font-medium leading-tight text-cream">{def.label}</span>
          <span className="mt-0.5 block text-[11px] text-sand">{def.hint}</span>
        </label>
        <span className="shrink-0 rounded-full border border-cream/12 bg-ink/50 px-2.5 py-1 font-mono text-[11.5px] text-cream tabular-nums">
          {def.format(value)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        className="range mt-3.5"
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--p": `${pct}%` } as CSSProperties}
        aria-valuetext={def.format(value)}
      />
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-sand/70 tabular-nums">
        <span>{def.format(def.min)}</span>
        <span>{def.format(def.max)}</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  big,
  accent,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  big?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="glass-inset px-4 py-3.5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-sand">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <p
          className={`font-display leading-none tabular-nums ${
            big ? "text-3xl sm:text-4xl" : "text-2xl sm:text-[1.7rem]"
          } ${accent ? "text-gradient" : "text-cream"}`}
        >
          {value}
        </p>
        {unit && <span className="text-[11px] text-sand">{unit}</span>}
      </div>
    </div>
  );
}

/* ───────────── Section ───────────── */
export default function ImpactCalculator() {
  const [inputs, setInputs] = useState(DEFAULTS);

  const hours = useMemo(() => (inputs.actions * inputs.minutes) / 60, [inputs]);
  const days = hours / 8;
  const monthValue = hours * inputs.rate;
  const yearValue = monthValue * 12;

  const tHours = useTweened(hours);
  const tDays = useTweened(days);
  const tMonth = useTweened(monthValue);
  const tYear = useTweened(yearValue);

  const fill = Math.min(1, tHours / BAR_CAP_HOURS);
  const isDefault =
    inputs.actions === DEFAULTS.actions && inputs.minutes === DEFAULTS.minutes && inputs.rate === DEFAULTS.rate;

  return (
    <section id="impact" className="relative scroll-mt-20 py-20 sm:py-28">
      {/* Ambient */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="glow-terra absolute left-1/2 top-1/2 h-[55vh] w-[70vw] -translate-x-1/2 -translate-y-1/2 opacity-25" />
      </div>

      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <ScrollReveal className="mx-auto max-w-3xl text-center">
          <p className="eyebrow">Business impact</p>
          <h2 className="font-display mt-4 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl lg:text-6xl">
            Where time, margin and attention <span className="text-gradient">are recovered.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-relaxed text-cream-2 sm:text-lg">
            Move the sliders to your own numbers. The value comes from reducing repeat work,
            protecting follow-through and making operating context visible.
          </p>
        </ScrollReveal>

        <ScrollReveal y={56} className="mt-12 sm:mt-16">
          <div className="glass relative overflow-hidden rounded-3xl">
            <div className="glow-terra pointer-events-none absolute -right-28 -top-28 h-80 w-80 opacity-30" />

            <div className="relative grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
              {/* LEFT · inputs */}
              <div className="border-b border-cream/10 p-5 sm:p-7 lg:border-b-0 lg:border-r">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-base font-medium text-cream sm:text-lg">Your volumes</h3>
                      <Pill tone="terra">
                        <Icon.bolt size={11} /> Interactive
                      </Pill>
                    </div>
                    <p className="mt-1 text-[12.5px] text-sand">
                      <span className="text-cream-2">Drag each slider.</span> Results update on the right.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInputs(DEFAULTS)}
                    disabled={isDefault}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-none border border-cream/12 bg-cream/[0.03] px-3 py-1.5 text-[12px] font-medium text-cream-2 transition-all hover:border-cream/30 hover:text-cream disabled:opacity-40"
                  >
                    Reset
                  </button>
                </div>

                <div className="mt-7 space-y-7">
                  {SLIDERS.map((s) => (
                    <Slider
                      key={s.key}
                      def={s}
                      value={inputs[s.key]}
                      onChange={(v) => setInputs((prev) => ({ ...prev, [s.key]: v }))}
                    />
                  ))}
                </div>

                <div className="mt-7 rounded-2xl border border-cream/[0.08] bg-cream/[0.025] px-4 py-3 text-[12px] leading-relaxed text-sand">
                  <span className="font-mono text-[11px] text-cream-2 tabular-nums">
                    {inputs.actions.toLocaleString("en-US")} × {inputs.minutes} min
                  </span>{" "}
                  ÷ 60 = hours recovered · × <span className="font-mono text-[11px] text-cream-2">Rs {inputs.rate}/h</span> =
                  value recovered.
                </div>
              </div>

              {/* RIGHT · results */}
              <div className="p-5 sm:p-7">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-sand">Recovered each month</p>
                  <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-sand">
                    <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terra-bright" /> live
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  <Stat label="Hours recovered / month" value={fmtHours(tHours)} unit="hrs" big accent />
                  <Stat label="Working days / month" value={fmtDays(tDays)} unit="days" big />
                  <Stat label="Value recovered / month" value={fmtMoney(tMonth)} />
                  <Stat label="Value recovered / year" value={fmtMoney(tYear)} />
                </div>

                {/* Twelve-month bars */}
                <div className="mt-5 rounded-2xl border border-cream/[0.08] bg-ink/35 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-sand">Hours back, month by month</p>
                    <span className="font-mono text-[10.5px] text-cream-2 tabular-nums">
                      {fmtHours(tHours * 12)} hrs / yr
                    </span>
                  </div>
                  <div className="mt-3 flex h-24 items-end gap-1.5 sm:h-28 sm:gap-2" aria-hidden>
                    {MONTHS.map((m, i) => (
                      <div key={`${m}${i}`} className="flex flex-1 flex-col items-center gap-1.5">
                        <div className="relative w-full flex-1 overflow-hidden rounded-md bg-cream/[0.05]">
                          <div
                            className="absolute inset-x-0 bottom-0 rounded-md bg-gradient-to-t from-terra-deep via-terra to-terra-bright shadow-[0_0_18px_-4px_rgba(198,93,59,0.7)]"
                            style={{ height: `${Math.max(3, fill * 100)}%` }}
                          />
                        </div>
                        <span className="font-mono text-[9px] text-sand/70">{m}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <p className="mt-3 text-[11px] leading-relaxed text-sand">
                  Illustrative only. Actual impact depends on workflow volume, process design,
                  adoption and connected services.
                </p>
              </div>
            </div>

            {/* Bottom line */}
            <div className="relative flex flex-wrap items-center justify-between gap-4 border-t border-cream/10 px-5 py-4 sm:px-7">
              <p className="text-[12.5px] text-cream-2">
                <span className="font-mono text-[12px] text-cream tabular-nums">300 actions × 8 minutes = 40 hours a month</span>{" "}
                <span className="text-sand">— replace with your real volumes on the walkthrough.</span>
              </p>
              <Link href="/contact" className="btn btn--ghost btn--sm">
                Book a walkthrough <Icon.arrow size={13} />
              </Link>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
