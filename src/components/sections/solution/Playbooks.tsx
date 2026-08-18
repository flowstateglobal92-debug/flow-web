import Image from "next/image";
import ScrollReveal from "@/components/ScrollReveal";

type Playbook = {
  n: string;
  title: string;
  outcome: string;
  trigger: string;
  decision: string;
  action: string;
  owner: string;
};

const PLAYBOOKS: Playbook[] = [
  {
    n: "01",
    title: "Instant form response",
    outcome: "No enquiry waits for office hours.",
    trigger: "Website form submitted or first WhatsApp message received",
    decision: "New contact or known client? Which service, which language?",
    action: "Acknowledge in under 35 seconds, qualify, offer a booking link",
    owner: "Sales rep — joins the chat on request or on a hot signal",
  },
  {
    n: "02",
    title: "Lead keep-warm",
    outcome: "Warm leads don't go cold in a busy week.",
    trigger: "No reply for 48 hours on an open lead",
    decision: "Lead score, last touch and what was promised",
    action: "Personalised nudge with the audit findings or next step",
    owner: "Assigned rep is notified the moment they reply",
  },
  {
    n: "03",
    title: "Promise-based follow-up",
    outcome: "“Call me on Tuesday” actually happens on Tuesday.",
    trigger: "A commitment is detected in a conversation",
    decision: "When, on which channel, and who made the promise",
    action: "Task and reminder created; the message is drafted for the day",
    owner: "Rep reviews, adjusts and sends",
  },
  {
    n: "04",
    title: "Proposal engagement",
    outcome: "You know the moment a proposal is opened.",
    trigger: "Proposal link opened — or idle for three days",
    decision: "First open, re-open, or silence",
    action: "Alert the rep, schedule the check-in, nudge if idle",
    owner: "Rep decides whether to call",
  },
  {
    n: "05",
    title: "Signed deal onboarding",
    outcome: "Signature starts the project — no re-keying.",
    trigger: "E-signature captured on the proposal",
    decision: "Package, milestones and deposit terms",
    action: "Workspace, portal link, kickoff tasks and deposit invoice created",
    owner: "Delivery lead assigned with the full sales context",
  },
  {
    n: "06",
    title: "Invoice collection",
    outcome: "Cash arrives on a cadence, not on a chase.",
    trigger: "Invoice issued; due date approaching or passed",
    decision: "Before due · On due · After due · Escalate",
    action: "Reminder with payment link at each step; cheque maturity alerts",
    owner: "Escalations go to finance or the owner",
  },
];

const ROWS: { key: keyof Pick<Playbook, "trigger" | "decision" | "action" | "owner">; label: string; auto: boolean }[] = [
  { key: "trigger", label: "Trigger", auto: true },
  { key: "decision", label: "Decision", auto: true },
  { key: "action", label: "Action", auto: true },
  { key: "owner", label: "Ownership", auto: false },
];

/**
 * The six standard automation playbooks, each written in the same grammar the
 * system uses: Trigger → Decision → Action → Ownership. The first three rows
 * run automatically; the last is always a named human.
 */
export default function Playbooks() {
  return (
    <section id="playbooks" className="relative scroll-mt-20 py-20 sm:py-28">
      {/* Ambient: the operating layer standing in the dark, far right, behind everything */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <Image
          src="/art/solution-monolith.webp"
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-[78%_50%] opacity-60"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/90 to-ink/30" />
        <div className="absolute inset-0 bg-gradient-to-b from-ink via-transparent to-ink" />
        <div className="glow-cream absolute -left-40 bottom-10 h-[40vh] w-[40vh] opacity-20" />
      </div>

      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <ScrollReveal className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="eyebrow">Automation playbooks</p>
            <h2 className="font-display mt-4 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl lg:text-6xl">
              Six routines that <span className="text-gradient">run themselves.</span>
            </h2>
            <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-cream-2 sm:text-lg">
              Every playbook is written in the same four lines — trigger, decision, action, ownership — so anyone
              in the business can read what will happen and who is accountable.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-sand">
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-terra-bright" /> Runs automatically
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-cream/40" /> Human-owned
            </span>
          </div>
        </ScrollReveal>

        <ScrollReveal
          as="ol"
          stagger="[data-playbook]"
          y={36}
          className="mt-12 grid gap-4 sm:mt-16 md:grid-cols-2 lg:grid-cols-3 lg:gap-5"
        >
          {PLAYBOOKS.map((p) => (
            <li
              key={p.n}
              data-playbook
              className="group glass relative flex flex-col overflow-hidden rounded-2xl p-6 transition-[transform,border-color,box-shadow] duration-500 ease-[var(--ease-flow)] hover:-translate-y-1 hover:border-cream/25 hover:shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85),0_0_0_1px_rgba(198,93,59,0.15)] sm:p-7"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-terra-bright">Playbook {p.n}</p>
                  <h3 className="font-display mt-2 text-xl font-medium leading-tight text-cream">{p.title}</h3>
                </div>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-cream-2">{p.outcome}</p>

              <ol className="mt-5 flex-1 space-y-0 border-t border-cream/[0.08]">
                {ROWS.map((r) => (
                  <li key={r.key} className="grid grid-cols-[76px_1fr] gap-3 border-b border-cream/[0.07] py-2.5 last:border-b-0">
                    <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-sand">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.auto ? "bg-terra-bright" : "bg-cream/40"}`} />
                      {r.label}
                    </span>
                    <span className={`text-[12.5px] leading-snug ${r.auto ? "text-cream-2" : "font-medium text-cream"}`}>
                      {p[r.key]}
                    </span>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ScrollReveal>

        <ScrollReveal className="mt-10 flex flex-col gap-3 border-t border-cream/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] text-sand">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-terra-bright">Principle</span>
            <span className="mx-3 text-cream/20">·</span>
            Routine steps run automatically. Approvals and exceptions stay human-owned.
          </p>
          <p className="text-[12.5px] text-sand">
            Custom playbooks are written the same way — for your steps, your promises, your cadence.
          </p>
        </ScrollReveal>
      </div>
    </section>
  );
}
