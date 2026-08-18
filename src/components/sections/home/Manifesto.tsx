import Image from "next/image";
import Link from "next/link";
import ScrollReveal from "@/components/ScrollReveal";

type Facet = {
  n: string;
  label: string;
  title: string;
  desc: string;
  img: string;
};

/** Who the company is — identity, not product. The system itself is the next section. */
const FACETS: Facet[] = [
  {
    n: "01",
    label: "The company",
    title: "Built directly by the team you talk to",
    desc: "You work directly with the people designing and engineering your system. No account managers, no handoffs, and no layers between your business and the build.",
    img: "/art/ic-designer.webp",
  },
  {
    n: "02",
    label: "The craft",
    title: "Systems designed, not software licensed",
    desc: "We don't resell a product. Every build starts from your pipeline, your language and your approvals — and ships as one operating layer that is yours.",
    img: "/art/ic-blueprint.webp",
  },
  {
    n: "03",
    label: "The ground",
    title: "Built for how business runs here",
    desc: "A Sri Lankan company. WhatsApp-first selling, three languages, instalments and cheque cycles are in the foundations — not bolted on later.",
    img: "/art/ic-map.webp",
  },
];

export default function Manifesto() {
  return (
    <section id="company" className="relative scroll-mt-20 py-20 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="glow-cream absolute -right-40 top-10 h-[45vh] w-[45vh] opacity-20" />
        <div className="glow-terra absolute -left-40 bottom-10 h-[40vh] w-[40vh] opacity-20" />
      </div>

      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          {/* Statement */}
          <ScrollReveal className="lg:sticky lg:top-28 lg:self-start">
            <p className="eyebrow">Who we are</p>
            <h2 className="font-display mt-4 text-balance text-4xl font-medium leading-[1.05] text-cream sm:text-5xl">
              A systems company for <span className="text-gradient">owner-led businesses.</span>
            </h2>
            <p className="mt-6 max-w-md text-pretty text-base leading-relaxed text-cream-2 sm:text-lg">
              Flow State is a small team of designers and engineers who build one thing well: the
              operating layer that runs a business day to day.
            </p>

            {/* Brand object — the mark as a physical thing */}
            <div className="relative mt-8 hidden lg:block">
              <div className="glow-terra absolute left-1/2 top-1/2 h-52 w-52 -translate-x-1/2 -translate-y-1/2 opacity-45" />
              <Image
                src="/art/logo-object.webp"
                alt=""
                width={1000}
                height={1000}
                sizes="220px"
                className="float-y relative h-auto w-[220px] drop-shadow-[0_24px_48px_rgba(0,0,0,0.6)]"
              />
            </div>
          </ScrollReveal>

          {/* Three facets of the company */}
          <ScrollReveal as="ol" stagger="[data-facet]" y={36} className="flex flex-col gap-4">
            {FACETS.map((f, i) => (
              <li key={f.n} data-facet>
                <article className="group glass spotlight relative overflow-hidden rounded-2xl p-6 transition-[transform,border-color,box-shadow] duration-500 ease-[var(--ease-flow)] hover:-translate-y-1 hover:border-cream/25 hover:shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85),0_0_0_1px_rgba(198,93,59,0.15)] sm:p-7">
                  {/* Glass object */}
                  <div
                    className="pointer-events-none absolute -right-2 top-1/2 w-[86px] -translate-y-1/2 sm:right-2 sm:w-[124px]"
                    aria-hidden
                  >
                    <div className="glow-terra absolute left-1/2 top-1/2 h-[85%] w-[85%] -translate-x-1/2 -translate-y-1/2 opacity-40 transition-opacity duration-500 group-hover:opacity-70" />
                    <Image
                      src={f.img}
                      alt=""
                      width={800}
                      height={800}
                      sizes="124px"
                      className="float-y relative h-auto w-full object-contain drop-shadow-[0_16px_32px_rgba(0,0,0,0.6)] transition-transform duration-700 ease-[var(--ease-flow)] group-hover:scale-[1.06]"
                      style={{ animationDelay: `${i * -1.9}s` }}
                    />
                  </div>

                  <div className="relative max-w-[calc(100%-82px)] sm:max-w-[calc(100%-136px)]">
                    <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-terra-bright">
                      {f.n} · {f.label}
                    </p>
                    <h3 className="font-display mt-2 text-xl font-medium leading-tight text-cream sm:text-2xl">
                      {f.title}
                    </h3>
                    <p className="mt-2.5 text-pretty text-[13.5px] leading-relaxed text-cream-2">{f.desc}</p>
                  </div>
                </article>
              </li>
            ))}

            <li className="mt-2 flex border-t border-cream/10 pt-5 sm:justify-end">
              <Link
                href="/about"
                className="group inline-flex min-h-[40px] items-center gap-2 py-1.5 text-[13px] text-cream-2 transition-colors hover:text-cream"
              >
                More about the company
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
            </li>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}
