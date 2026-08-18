import ScrollReveal from "@/components/ScrollReveal";

const BELIEFS = [
  {
    n: "01",
    statement: "Follow-through is the product.",
    body: "Not the dashboard, not the AI. What a business is paid for is doing what it said, when it said. Everything we build exists to protect that.",
  },
  {
    n: "02",
    statement: "The system adapts to the business — never the other way round.",
    body: "Your pipeline stages, your language, your approvals. If a workflow needs a manual, it isn't finished.",
  },
  {
    n: "03",
    statement: "Automation should feel like a good operations manager.",
    body: "Calm, consistent, and clear about when to bring a person in. Never a robot that answers everything and understands nothing.",
  },
  {
    n: "04",
    statement: "Owners deserve to see the whole business in one place.",
    body: "Pipeline to cash, in one view, with the history attached. Not five tabs and a question to three people.",
  },
];

export default function Beliefs() {
  return (
    <section id="beliefs" className="relative scroll-mt-20 py-20 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="glow-cream absolute -left-40 top-1/4 h-[45vh] w-[45vh] opacity-20" />
      </div>

      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <ScrollReveal className="max-w-3xl">
          <p className="eyebrow">What we believe</p>
          <h2 className="font-display mt-4 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl lg:text-6xl">
            Four convictions <span className="text-gradient">behind every system.</span>
          </h2>
        </ScrollReveal>

        <ScrollReveal as="ol" stagger="[data-belief]" y={30} className="mt-10 border-t border-cream/10 sm:mt-14">
          {BELIEFS.map((b) => (
            <li
              key={b.n}
              data-belief
              className="group grid gap-3 border-b border-cream/10 py-8 sm:grid-cols-[72px_minmax(0,7fr)_minmax(0,5fr)] sm:gap-8 sm:py-10"
            >
              <span className="font-mono text-[11px] tracking-[0.2em] text-terra-bright">{b.n}</span>
              <h3 className="font-display text-2xl font-medium leading-tight text-cream transition-colors duration-500 sm:text-3xl lg:text-[2.1rem]">
                {b.statement}
              </h3>
              <p className="text-[14px] leading-relaxed text-cream-2 sm:pt-1.5 sm:text-[14.5px]">{b.body}</p>
            </li>
          ))}
        </ScrollReveal>
      </div>
    </section>
  );
}
