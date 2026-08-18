import ScrollReveal from "@/components/ScrollReveal";

const STEPS = [
  {
    n: "01",
    when: "Within one working day",
    title: "We confirm a slot",
    body: "On WhatsApp or email — whichever you gave us — with two or three times to choose from.",
  },
  {
    n: "02",
    when: "30 minutes, on a call",
    title: "We map the work together",
    body: "You walk us through how an enquiry becomes a paid job today. We note where it waits, where it's re-typed and where it leaks.",
  },
  {
    n: "03",
    when: "Same week",
    title: "You receive the automation map",
    body: "The first three automations, in trigger → decision → action → ownership form, with the connections they need. Yours to keep.",
  },
  {
    n: "04",
    when: "If it makes sense",
    title: "We scope the rollout",
    body: "Map, Configure, Connect, Optimize — with the first playbooks live inside two weeks. No pressure either way.",
  },
];

const BRING = [
  "How a lead reaches you today (WhatsApp, forms, calls, referrals)",
  "One recent proposal or quotation, and how it was sent",
  "One recent invoice, and how it was chased",
  "The tools you use now — even if it's just chats and a spreadsheet",
  "Roughly how many enquiries, quotes and invoices you handle a month",
];

export default function NextSteps() {
  return (
    <section id="next" className="relative scroll-mt-20 py-20 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="glow-terra absolute -left-40 top-1/3 h-[50vh] w-[50vh] opacity-25" />
      </div>

      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <ScrollReveal className="max-w-3xl">
          <p className="eyebrow">What happens next</p>
          <h2 className="font-display mt-4 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl lg:text-6xl">
            From message <span className="text-gradient">to map.</span>
          </h2>
          <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-cream-2 sm:text-lg">
            No discovery decks, no proposals before we understand the work. Four short steps, and you leave the
            first one with something useful.
          </p>
        </ScrollReveal>

        <div className="mt-12 grid grid-cols-1 gap-5 sm:mt-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-6">
          <ScrollReveal as="ol" stagger="[data-step]" y={30} className="glass rounded-3xl px-5 sm:px-7">
            {STEPS.map((s) => (
              <li
                key={s.n}
                data-step
                className="grid grid-cols-1 gap-3 border-t border-cream/[0.08] py-6 first:border-t-0 sm:grid-cols-[56px_170px_1fr] sm:gap-6"
              >
                <span className="font-mono text-[11px] tracking-[0.2em] text-terra-bright">{s.n}</span>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-sand">{s.when}</span>
                <div>
                  <h3 className="font-display text-lg font-medium leading-tight text-cream">{s.title}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-cream-2">{s.body}</p>
                </div>
              </li>
            ))}
          </ScrollReveal>

          <ScrollReveal y={40}>
            <aside className="glass rounded-3xl p-5 sm:p-6">
              <p className="eyebrow eyebrow--muted text-[10px]">Worth having to hand</p>
              <p className="mt-2 text-[13px] leading-relaxed text-cream-2">
                None of it is required — but the more real your examples, the sharper the map.
              </p>
              <ul className="mt-5 space-y-2.5">
                {BRING.map((b) => (
                  <li key={b} className="flex items-start gap-2.5 text-[13px] leading-snug text-cream-2">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      className="mt-[3px] shrink-0 text-terra-bright"
                      aria-hidden
                    >
                      <path d="m5 12 4.5 4.5L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 border-t border-cream/[0.07] pt-4 font-mono text-[10.5px] tracking-[0.06em] text-sand">
                No obligation <span className="mx-1.5 text-cream/25">·</span> 30-minute call{" "}
                <span className="mx-1.5 text-cream/25">·</span> You keep the map.
              </p>
            </aside>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}
