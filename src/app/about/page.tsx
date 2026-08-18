import Nav from "@/components/Nav";
import PageHero from "@/components/PageHero";
import CtaButton from "@/components/CtaButton";
import Story from "@/components/sections/about/Story";
import Beliefs from "@/components/sections/about/Beliefs";
import Company from "@/components/sections/about/Company";
import Contrast from "@/components/sections/about/Contrast";
import CTA from "@/components/sections/CTA";
import Footer from "@/components/sections/Footer";
import { jsonLd, pageMeta, pageSchema } from "@/lib/site";

export const metadata = pageMeta({
  title: "About — the company behind your operating layer",
  description:
    "Flow State is a small, senior team building custom AI and automation for owner-led businesses in Sri Lanka. Who we are, what we believe, and how we work.",
  path: "/about",
  image: "/og/about.png",
  keywords: ["about Flow State", "AI automation company Sri Lanka", "systems company"],
});

export default function AboutPage() {
  return (
    <main className="relative overflow-x-clip">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            pageSchema({
              path: "/about",
              name: "About Flow State",
              description:
                "A small, senior team building custom AI and automation for owner-led businesses in Sri Lanka.",
              crumbs: [{ name: "About", path: "/about" }],
            }),
          ),
        }}
      />
      <Nav />
      <PageHero
        eyebrow="About Flow State"
        lines={["We design systems", "that run your business."]}
        sub="Flow State is a small, senior team that builds custom AI and automation for owner-led businesses — one shared record, one automation engine, one command surface — so the routine runs itself and your people keep the decisions."
        image={{ src: "/art/about-hero.webp", focus: "72% 55%" }}
        video={{ src: "/art/about-loop.mp4" }}
        actions={
          <>
            <CtaButton href="/solution" variant="solid">
              See our solution
            </CtaButton>
            <CtaButton href="/contact" variant="ghost">
              Book a walkthrough
            </CtaButton>
          </>
        }
      >
        <div className="hairline" />
        <ul className="mx-auto mt-6 grid max-w-4xl grid-cols-2 gap-y-6 text-center sm:grid-cols-4 sm:divide-x sm:divide-cream/10">
          {[
            ["Custom", "designed per business"],
            ["Senior", "the builders are the team"],
            ["Weeks", "to the first live playbook"],
            ["Visible", "every rule, every action"],
          ].map(([big, small]) => (
            <li key={big} className="px-3">
              <p className="font-display text-lg leading-none text-cream sm:text-xl">{big}</p>
              <p className="mt-2 text-[11px] leading-snug text-sand">{small}</p>
            </li>
          ))}
        </ul>
      </PageHero>
      <Story />
      <Beliefs />
      <Company />
      <Contrast />
      <CTA
        eyebrow="Meet the team"
        title={
          <>
            Thirty minutes with the people <span className="text-gradient">who&apos;ll build it.</span>
          </>
        }
        copy="Tell us where the week breaks. We'll map the first three automations with you on the call — and you keep the map whether or not we work together."
      />
      <Footer />
    </main>
  );
}
