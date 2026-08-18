import ScrollReveal from "@/components/ScrollReveal";

const ROWS = [
  ["A subscription you configure yourself", "A system designed and configured around you"],
  ["A slide deck of recommendations", "A working system you can touch on day one"],
  ["A robot that answers everything", "An operations layer that knows when to hand over"],
  ["A black box", "Every rule and every action visible in the feed"],
  ["A one-off project", "A rollout with the optimise step built in"],
] as const;

/**
 * What we're not. Same friction → flow grammar the rest of the site uses:
 * the left column is struck through, the right is what you actually get.
 */
export default function Contrast() {
  return (
    <section id="not" className="relative scroll-mt-20 py-20 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="glow-terra absolute left-1/2 top-1/2 h-[50vh] w-[70vw] -translate-x-1/2 -translate-y-1/2 opacity-20" />
      </div>

      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <ScrollReveal className="mx-auto max-w-3xl text-center">
          <p className="eyebrow">What we&apos;re not</p>
          <h2 className="font-display mt-4 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl lg:text-6xl">
            Easier to say <span className="text-gradient">what we won&apos;t be.</span>
          </h2>
        </ScrollReveal>

        <ScrollReveal y={48} className="mt-12 sm:mt-16">
          <ul className="glass mx-auto max-w-4xl rounded-3xl px-5 sm:px-8">
            {ROWS.map(([not, yes], i) => (
              <li
                key={not}
                className="grid grid-cols-1 gap-2 border-t border-cream/[0.08] py-5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] sm:items-center sm:gap-6"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 font-mono text-[10px] text-sand tabular-nums">0{i + 1}</span>
                  <p className="text-[13.5px] leading-snug text-sand line-through decoration-terra-bright/60 sm:text-[14px]">{not}</p>
                </div>
                <span className="hidden text-terra-bright sm:block" aria-hidden>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div className="flex items-start gap-3 pl-6 sm:pl-0">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center bg-terra/20 text-[10px] text-terra-bright ring-1 ring-terra/30">
                    ✓
                  </span>
                  <p className="text-[13.5px] font-medium leading-snug text-cream sm:text-[14px]">{yes}</p>
                </div>
              </li>
            ))}
          </ul>
        </ScrollReveal>
      </div>
    </section>
  );
}
