import ReactDOM from "react-dom";
import Nav from "@/components/Nav";
import Preloader from "@/components/Preloader";
import Hero from "@/components/hero/Hero";
import Manifesto from "@/components/sections/home/Manifesto";
import SystemSection from "@/components/sections/SystemSection";
import WhyUs from "@/components/sections/home/WhyUs";
import Principles from "@/components/sections/home/Principles";
import Process from "@/components/sections/Process";
import Fit from "@/components/sections/home/Fit";
import FAQ, { type FaqItem } from "@/components/sections/FAQ";
import CTA from "@/components/sections/CTA";
import Footer from "@/components/sections/Footer";
import { abs, jsonLd, pageMeta, pageSchema } from "@/lib/site";

const HOME_FAQ: FaqItem[] = [
  {
    q: "Do we have to replace the tools we already use?",
    a: "No. We map what you use today and connect what should stay — WhatsApp, your calendar, your accounting export, your website forms. The system becomes the shared record and the automation engine on top; anything that duplicates it can be retired later, on your timetable.",
  },
  {
    q: "How long before something is actually running?",
    a: "The rollout is four steps: Map, Configure, Connect, Optimize. The first automations — usually instant response and follow-up — go live inside the first two weeks. We expand from what's proven in your numbers, not from a wish list.",
  },
  {
    q: "What happens when the AI isn't sure?",
    a: "It hands over. Every conversation and playbook has a human owner, and anything that needs judgement — a price exception, an unhappy client, an unusual request — is routed to that person with the full context. Routine runs itself; approvals stay yours.",
  },
  {
    q: "Do we need technical staff to run it?",
    a: "No. Rules are written in plain business terms (Trigger → Decision → Action → Ownership) and the copilot answers questions in normal language. Owners and operations staff run it day to day; we handle configuration and changes.",
  },
  {
    q: "How is it priced?",
    a: "Per system, after the mapping call — the scope depends on which capabilities you need and what has to be connected. You'll see the automation map and the plan before anything is built, and you keep the map either way.",
  },
  {
    q: "Where are you based, and can you work with us remotely?",
    a: "We are based in Sri Lanka, and the system is designed for how business runs here — English, Sinhala and Tamil, WhatsApp-first, rupee invoicing. Mapping and rollout happen on calls and shared screens, so location isn't a constraint.",
  },
];

export const metadata = pageMeta({
  title: "Flow State — AI systems that put your business in flow",
  absoluteTitle: true,
  description:
    "Flow State designs custom AI and automation systems for owner-led businesses in Sri Lanka — one shared record, one automation engine, one command surface. Try the live system.",
  path: "/",
  image: "/og/home.png",
});

export default function Home() {
  // The hero art is the LCP element here and nowhere else. React hoists this
  // into <head>, so it is still discovered before the body is parsed.
  ReactDOM.preload("/art/hero-bg.webp", { as: "image", fetchPriority: "high" });

  return (
    <main className="relative overflow-x-clip">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd([
            pageSchema({
              path: "/",
              name: "Flow State — AI systems that put your business in flow",
              description:
                "Custom AI and automation systems for owner-led businesses in Sri Lanka.",
            }),
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              "@id": abs("/#faq"),
              mainEntity: HOME_FAQ.map((f) => ({
                "@type": "Question",
                name: f.q,
                acceptedAnswer: { "@type": "Answer", text: String(f.a) },
              })),
            },
          ]),
        }}
      />
      <Preloader />
      <Nav />
      <Hero />
      <Manifesto />
      <SystemSection />
      <WhyUs />
      <Principles />
      <Process />
      <Fit />
      <FAQ items={HOME_FAQ} />
      <CTA />
      <Footer />
    </main>
  );
}
