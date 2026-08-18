import ScrollReveal from "@/components/ScrollReveal";
import GlassIcon from "@/components/GlassIcon";

const PROMISES = [
  {
    n: "01",
    title: "You talk to the people building it",
    body: "No account layer in between. The person who maps your operation is the person who configures it — and the one you message when something needs to change.",
  },
  {
    n: "02",
    title: "You see it working before you commit further",
    body: "First the live system on our site. Then your own workflows in the automation map. Then the first playbooks running in your business inside two weeks.",
  },
  {
    n: "03",
    title: "We stay after launch",
    body: "Optimize is a step in the rollout, not an afterthought. We review outcomes with you — hours recovered, cash collected, leads answered — and expand what's proven.",
  },
];

const ROLES: { icon: string; title: string; body: string }[] = [
  { icon: "ic-designer", title: "Systems designer", body: "Maps the operation, writes the playbooks, decides what stays human." },
  { icon: "ic-engineer", title: "Automation engineer", body: "Connects channels and data, configures rules, keeps the record clean." },
  { icon: "ic-conversation", title: "Conversation designer", body: "The AI's tone, its languages, and exactly when it hands over." },
  { icon: "ic-delivery", title: "Delivery lead", body: "Rollout, training and the monthly review of what the numbers say." },
];

export default function Company() {
  return (
    <section id="company" className="relative scroll-mt-20 py-20 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="glow-terra absolute -left-40 bottom-0 h-[50vh] w-[50vh] opacity-25" />
        <div className="glow-cream absolute -right-40 top-10 h-[40vh] w-[40vh] opacity-20" />
      </div>

      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:gap-16">
          {/* Promises */}
          <ScrollReveal>
            <p className="eyebrow">Working with us</p>
            <h2 className="font-display mt-4 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl lg:text-6xl">
              A partner, <span className="text-gradient">not a vendor.</span>
            </h2>
            <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-cream-2 sm:text-lg">
              Small, senior and close to the work. Three things you can hold us to from the first call.
            </p>
            <ol className="mt-9 space-y-6 border-t border-cream/10 pt-8">
              {PROMISES.map((p) => (
                <li key={p.n} className="grid grid-cols-[40px_1fr] gap-4">
                  <span className="font-mono text-[11px] tracking-[0.2em] text-terra-bright">{p.n}</span>
                  <div>
                    <h3 className="font-display text-xl font-medium leading-tight text-cream">{p.title}</h3>
                    <p className="mt-2 text-[14px] leading-relaxed text-cream-2">{p.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </ScrollReveal>

          {/* Team behind every system */}
          <ScrollReveal y={48}>
            <div className="glass rounded-3xl p-5 sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-display text-base font-medium text-cream sm:text-lg">The team behind every system</p>
                  <p className="mt-1 text-[12.5px] text-sand">Four roles, one small crew — assembled per project.</p>
                </div>
                <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-sand">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terra-bright" /> Senior only
                </span>
              </div>

              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {ROLES.map((r, i) => (
                  <li
                    key={r.icon}
                    className="group rounded-2xl border border-cream/[0.08] bg-cream/[0.025] p-4 transition-colors duration-500 hover:border-cream/20"
                  >
                    <GlassIcon name={r.icon} size={64} delay={i * -1.4} />
                    <p className="font-display mt-3 text-[15px] font-medium text-cream">{r.title}</p>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-sand">{r.body}</p>
                  </li>
                ))}
              </ul>

              <div className="mt-6 grid gap-3 border-t border-cream/[0.07] pt-5 sm:grid-cols-3">
                {[
                  ["Based in", "Sri Lanka"],
                  ["Office hours", "Mon–Sat"],
                  ["Calls in", "English · Sinhala · Tamil"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-sand">{k}</p>
                    <p className="mt-1 text-[13.5px] text-cream-2">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}
