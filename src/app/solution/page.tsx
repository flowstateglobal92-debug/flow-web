import Nav from "@/components/Nav";
import PageHero from "@/components/PageHero";
import CtaButton from "@/components/CtaButton";
import RevenueCycle from "@/components/sections/RevenueCycle";
import Capabilities from "@/components/sections/Capabilities";
import Playbooks from "@/components/sections/solution/Playbooks";
import BeforeAfter from "@/components/sections/BeforeAfter";
import ImpactCalculator from "@/components/sections/ImpactCalculator";
import CTA from "@/components/sections/CTA";
import Footer from "@/components/sections/Footer";
import { abs, jsonLd, pageMeta, pageSchema } from "@/lib/site";

export const metadata = pageMeta({
  title: "Our solution — one operating layer, first message to money",
  description:
    "Nine capabilities, six automation playbooks and one shared customer record. See how Flow State turns enquiries into signed, delivered and paid work automatically.",
  path: "/solution",
  image: "/og/solution.png",
  keywords: [
    "AI sales automation",
    "WhatsApp AI sales representative",
    "visual CRM lead scoring",
    "automated invoicing collections",
    "workflow automation playbooks",
  ],
});

const CHAPTERS = [
  ["01", "Operating flow", "#cycle"],
  ["02", "Capabilities", "#capabilities"],
  ["03", "Playbooks", "#playbooks"],
  ["04", "Before → after", "#shift"],
  ["05", "Impact", "#impact"],
] as const;

const CAPABILITIES = [
  "WhatsApp AI sales representative",
  "Automated lead hunter",
  "AI content studio",
  "Visual CRM and lead scoring",
  "Workflow automations",
  "Digital proposals and e-sign",
  "Financial operations",
  "Client portal and scheduler",
  "Voice and text copilot",
];

const serviceSchema = {
  "@context": "https://schema.org",
  "@type": "Service",
  "@id": abs("/solution#service"),
  name: "Custom AI and automation systems",
  serviceType: "Business process automation",
  provider: { "@id": abs("/#organization") },
  areaServed: { "@type": "Country", name: "Sri Lanka" },
  description:
    "One operating layer for owner-led businesses: nine capabilities sharing one customer record, one automation engine and one command surface.",
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    name: "Capabilities",
    itemListElement: CAPABILITIES.map((name) => ({
      "@type": "Offer",
      itemOffered: { "@type": "Service", name },
    })),
  },
};

export default function SolutionPage() {
  return (
    <main className="relative overflow-x-clip">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd([
            pageSchema({
              path: "/solution",
              name: "Our solution — one operating layer, first message to money",
              description:
                "Nine capabilities, six automation playbooks and one shared customer record.",
              crumbs: [{ name: "Our solution", path: "/solution" }],
            }),
            serviceSchema,
          ]),
        }}
      />
      <Nav />
      <PageHero
        eyebrow="Our solution · Flow State OS"
        lines={["One operating layer.", "First message to money."]}
        sub="Nine capabilities share one customer record, one automation engine and one command surface. We configure the mix for your business, so enquiries become signed, delivered and paid work without anyone re-typing a thing."
        image={{ src: "/art/solution-hero.webp", focus: "72% 50%" }}
        actions={
          <>
            <CtaButton href="/#system" variant="solid">
              Try the live system
            </CtaButton>
            <CtaButton href="/contact" variant="ghost">
              Book a walkthrough
            </CtaButton>
          </>
        }
      >
        <div className="hairline" />
        <nav aria-label="On this page" className="mt-6">
          <ul className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2 sm:gap-x-3">
            {CHAPTERS.map(([n, label, href]) => (
              <li key={href}>
                <a
                  href={href}
                  className="inline-flex items-center gap-2 rounded-none border border-cream/12 bg-cream/[0.03] px-3.5 py-2 text-[12.5px] text-cream-2 transition-colors hover:border-cream/30 hover:text-cream"
                >
                  <span className="font-mono text-[10px] text-terra-bright">{n}</span>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </PageHero>
      <RevenueCycle />
      <Capabilities />
      <Playbooks />
      <BeforeAfter />
      <ImpactCalculator />
      <CTA
        eyebrow="Ready when you are"
        title={
          <>
            See it running on <span className="text-gradient">your workflows.</span>
          </>
        }
        copy="Bring the three steps that cost you the most time. In one 30-minute call we map them into the operating flow you've just read — and you keep the map."
        secondary={{ label: "Try the live system", href: "/#system" }}
      />
      <Footer />
    </main>
  );
}
