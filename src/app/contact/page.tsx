import Nav from "@/components/Nav";
import PageHero from "@/components/PageHero";
import WalkthroughForm from "@/components/WalkthroughForm";
import NextSteps from "@/components/sections/contact/NextSteps";
import FAQ, { type FaqItem } from "@/components/sections/FAQ";
import Footer from "@/components/sections/Footer";
import { SITE, abs, jsonLd, pageMeta, pageSchema } from "@/lib/site";

export const metadata = pageMeta({
  title: "Contact — book a 30-minute walkthrough",
  description:
    "Tell us where your week breaks. In one 30-minute call we map your first three automations — and you keep the map. WhatsApp, email or the form.",
  path: "/contact",
  image: "/og/contact.png",
  keywords: ["contact Flow State", "AI automation consultation Sri Lanka", "book a walkthrough"],
});

const CONTACT_FAQ: FaqItem[] = [
  {
    q: "Is the walkthrough really free?",
    a: "Yes. Thirty minutes, no obligation, and the automation map is yours to keep whether or not we go further. We'd rather show you the thinking than send a proposal you can't judge.",
  },
  {
    q: "Can we just talk on WhatsApp first?",
    a: "Of course — that's how most conversations start. Message us with one sentence about your business and the step that breaks most often, and we'll take it from there.",
  },
  {
    q: "What if we're not sure what to automate?",
    a: "That's the point of the call. Walk us through how an enquiry becomes a paid job today; we'll find the repeat steps, the waits and the leaks, and turn the biggest three into a map.",
  },
  {
    q: "Do you work with businesses outside Sri Lanka?",
    a: "The system is designed for how business runs here first — WhatsApp, three languages, rupee invoicing — but the mapping and rollout happen on calls and shared screens. If your work moves the same way, we should talk.",
  },
  {
    q: "How soon can something be live?",
    a: "After mapping, the rollout is Map → Configure → Connect → Optimize. The first playbooks — usually instant response and follow-up — go live inside the first two weeks.",
  },
];

const CHANNELS = [
  {
    label: "WhatsApp",
    value: "Message the team",
    hint: "Fastest reply · Mon–Sat",
    href: "#",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M4 20l1.3-4A8.5 8.5 0 1 1 8.5 19z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M9.5 9.5c0 3 2 5 5 5l1-1.5-2-1-1 .8a3.5 3.5 0 0 1-1.6-1.6l.8-1-1-2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: "Email",
    value: "support@flowstate.lk",
    hint: "Reply within one working day",
    href: "mailto:support@flowstate.lk",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="3.5" y="5.5" width="17" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="m4.5 7 7.5 6 7.5-6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: "Office",
    value: "Sri Lanka · Mon–Sat",
    hint: "Calls in English, Sinhala or Tamil",
    href: null,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
] as const;

export default function ContactPage() {
  return (
    <main className="relative overflow-x-clip">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd([
            pageSchema({
              path: "/contact",
              name: "Contact Flow State",
              description: "Book a 30-minute walkthrough and map your first three automations.",
              crumbs: [{ name: "Contact", path: "/contact" }],
            }),
            {
              "@context": "https://schema.org",
              "@type": "ContactPage",
              "@id": abs("/contact#contactpage"),
              url: abs("/contact"),
              mainEntity: {
                "@type": "Organization",
                "@id": abs("/#organization"),
                email: SITE.email,
                contactPoint: {
                  "@type": "ContactPoint",
                  contactType: "sales",
                  email: SITE.email,
                  availableLanguage: [...SITE.languages],
                },
              },
            },
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              "@id": abs("/contact#faq"),
              mainEntity: CONTACT_FAQ.map((f) => ({
                "@type": "Question",
                name: f.q,
                acceptedAnswer: { "@type": "Answer", text: String(f.a) },
              })),
            },
          ]),
        }}
      />
      <Nav />
      <PageHero
        eyebrow="Contact us"
        lines={["Tell us where", "the week breaks."]}
        sub="Thirty minutes with the people who'll build it. We map your first three automations on the call — and you keep the map, whether or not we work together."
        image={{ src: "/art/contact-hero.webp", focus: "66% 50%" }}
        actions={
          <ul className="w-full max-w-[34rem] divide-y divide-cream/10 border-y border-cream/10">
            {CHANNELS.map((c) => {
              const inner = (
                <>
                  <span className="glass-inset flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-cream-2 transition-colors duration-300 group-hover:text-terra-bright">
                    {c.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] uppercase tracking-[0.16em] text-sand">{c.label}</span>
                    <span className="block truncate text-[14px] font-medium text-cream">{c.value}</span>
                  </span>
                  <span className="hidden text-[11.5px] text-sand sm:block">{c.hint}</span>
                </>
              );
              return (
                <li key={c.label}>
                  {c.href ? (
                    <a href={c.href} className="group flex items-center gap-4 py-3.5 transition-colors hover:text-cream">
                      {inner}
                    </a>
                  ) : (
                    <div className="flex items-center gap-4 py-3.5">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        }
        aside={
          <div id="walkthrough" className="scroll-mt-28">
            <div className="glass-inset rounded-2xl p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] sm:p-6">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-base font-medium text-cream sm:text-lg">Request a walkthrough</p>
                  <p className="mt-1 text-[12.5px] text-sand">Two minutes to fill in. We reply within one working day.</p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-sand">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terra-bright" /> Open
                </span>
              </div>
              <WalkthroughForm withMessage />
            </div>
            <p className="mt-4 text-center font-mono text-[10.5px] tracking-[0.06em] text-sand lg:text-left">
              No obligation <span className="mx-1.5 text-cream/25">·</span> 30-minute call{" "}
              <span className="mx-1.5 text-cream/25">·</span> You keep the automation map.
            </p>
          </div>
        }
      />
      <NextSteps />
      <FAQ
        items={CONTACT_FAQ}
        eyebrow="Before you book"
        title={
          <>
            The short <span className="text-gradient">answers.</span>
          </>
        }
        sub="Everything people usually ask before the first call. If yours isn't here, the form above is the quickest way to ask."
        cta={{ label: "Back to the form", href: "#walkthrough", note: "Yours isn't here?" }}
      />
      <Footer />
    </main>
  );
}
