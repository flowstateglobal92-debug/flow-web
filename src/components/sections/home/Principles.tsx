import ScrollReveal from "@/components/ScrollReveal";
import GlassIcon from "@/components/GlassIcon";

const PRINCIPLES: { icon: string; n: string; title: string; body: string }[] = [
  {
    icon: "ic-blueprint",
    n: "01",
    title: "Map before we build",
    body: "We start with the work that slows growth down — repeat steps, delays and leaks — not with a feature list.",
  },
  {
    icon: "ic-record",
    n: "02",
    title: "One shared record",
    body: "Every module reads and writes the same customer history, so context travels with the deal instead of living in someone's chat.",
  },
  {
    icon: "ic-handover",
    n: "03",
    title: "Routine automated, exceptions human",
    body: "The system runs the predictable steps. Anything that needs judgement is routed to a named owner with the full picture.",
  },
  {
    icon: "ic-weeks",
    n: "04",
    title: "Weeks, not quarters",
    body: "The first automations go live inside the rollout's first two weeks, then we expand what's proven rather than what's promised.",
  },
  {
    icon: "ic-measure",
    n: "05",
    title: "Measured in hours and cash",
    body: "Every automated action logs the minutes it saved. We review outcomes with you and tune the rules — that's the optimise step.",
  },
  {
    icon: "ic-visible",
    n: "06",
    title: "Nothing hidden",
    body: "Every rule, every action and every handoff is visible in the activity feed. You always know what ran, for whom, and why.",
  },
];

/**
 * How we operate — the company's working principles. Sits between the live
 * system and the rollout so the visitor understands the character of the
 * people behind the screens before they see the timeline.
 */
export default function Principles() {
  return (
    <section id="operate" className="relative scroll-mt-20 py-20 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="glow-cream absolute -right-40 top-1/4 h-[45vh] w-[45vh] opacity-20" />
        <div className="glow-terra absolute -left-32 bottom-0 h-[45vh] w-[45vh] opacity-25" />
      </div>

      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <ScrollReveal className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="eyebrow">How we operate</p>
            <h2 className="font-display mt-4 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl lg:text-6xl">
              Six rules we <span className="text-gradient">don&apos;t break.</span>
            </h2>
            <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-cream-2 sm:text-lg">
              They shape every system we design — and they&apos;re why the systems keep running after we&apos;ve
              left the room.
            </p>
          </div>
          <p className="max-w-xs text-[12.5px] leading-relaxed text-sand lg:text-right">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-terra-bright">Principle</span>
            <span className="mx-2 text-cream/20">·</span>
            Routine steps run automatically. Approvals and exceptions stay human-owned.
          </p>
        </ScrollReveal>

        <ScrollReveal
          as="ol"
          stagger="[data-principle]"
          y={36}
          className="mt-12 grid grid-cols-1 gap-4 sm:mt-16 md:grid-cols-2 lg:grid-cols-3 lg:gap-5"
        >
          {PRINCIPLES.map((p, i) => (
            <li
              key={p.icon}
              data-principle
              className="group glass spotlight relative overflow-hidden rounded-2xl p-6 transition-[transform,border-color,box-shadow] duration-500 ease-[var(--ease-flow)] hover:-translate-y-1 hover:border-cream/25 hover:shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85),0_0_0_1px_rgba(198,93,59,0.15)] sm:p-7"
            >
              <div className="relative flex items-start justify-between gap-3">
                <GlassIcon name={p.icon} size={76} delay={i * -1.1} />
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-terra-bright">{p.n}</span>
              </div>
              <h3 className="font-display relative mt-5 text-lg font-medium leading-tight text-cream sm:text-xl">
                {p.title}
              </h3>
              <p className="relative mt-2 text-[13.5px] leading-relaxed text-cream-2">{p.body}</p>
            </li>
          ))}
        </ScrollReveal>
      </div>
    </section>
  );
}
