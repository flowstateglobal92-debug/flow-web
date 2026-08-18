import LegalPage, { type LegalSection } from "@/components/sections/legal/LegalPage";
import { SITE, jsonLd, pageMeta, pageSchema } from "@/lib/site";

export const metadata = pageMeta({
  title: "Terms of Service",
  description:
    "The terms that apply to using flowstate.lk, requesting a walkthrough, and engaging Flow State to design and build a system.",
  path: "/terms",
  image: "/og/terms.png",
});

const UPDATED = "17 August 2026";

const SECTIONS: LegalSection[] = [
  {
    heading: "These terms",
    body: (
      <p>
        They apply to your use of <strong>flowstate.lk</strong> and to any enquiry you send through
        it. Paid work is governed by the separate written agreement we sign with you; where that
        agreement and these terms disagree, <strong>the signed agreement wins</strong>.
      </p>
    ),
  },
  {
    heading: "What the site is",
    body: (
      <>
        <p>
          The site describes the systems we design and includes an interactive demonstration of
          Flow State OS. That demonstration runs entirely in your browser with sample data. It is an
          illustration of how a system can work — not a live product account, and nothing you enter
          into it is stored or sent to us.
        </p>
        <p>
          Figures shown in examples and calculators are illustrative. Actual results depend on your
          workflow volume, process design, adoption and connected services.
        </p>
      </>
    ),
  },
  {
    heading: "Walkthroughs and enquiries",
    body: (
      <>
        <p>
          A walkthrough is a free, no-obligation conversation. The automation map produced on that
          call is yours to keep and use, whether or not we go on to work together.
        </p>
        <p>
          Requesting a walkthrough does not create a contract. Nothing on this site is an offer
          capable of acceptance; scope and price are agreed in writing.
        </p>
      </>
    ),
  },
  {
    heading: "Acceptable use",
    body: (
      <>
        <p>Please do not:</p>
        <ul>
          <li>attempt to disrupt, overload or gain unauthorised access to the site;</li>
          <li>scrape the site in a way that degrades it for others;</li>
          <li>copy the site&apos;s design, copy or code to pass off as your own;</li>
          <li>use the contact channels to send unlawful or abusive content.</li>
        </ul>
        <p>
          Search engines and AI agents are welcome to crawl and index the site within the limits set
          in our <a href="/robots.txt">robots.txt</a>.
        </p>
      </>
    ),
  },
  {
    heading: "Intellectual property",
    body: (
      <>
        <p>
          The site, its content, its imagery and the Flow State name and mark belong to us. You may
          share and quote pages with attribution and a link.
        </p>
        <p>
          Ownership of work produced under a signed engagement is set out in that agreement. Our
          standard position: you own your data and the configuration built for your business, and we
          keep ownership of the underlying tooling and methods we reuse across clients.
        </p>
      </>
    ),
  },
  {
    heading: "Third-party services",
    body: (
      <p>
        Systems we build often connect to services you already use — messaging platforms, calendars,
        accounting tools. Those services have their own terms and availability, and we are not
        responsible for their acts, outages or pricing changes.
      </p>
    ),
  },
  {
    heading: "Availability and liability",
    body: (
      <>
        <p>
          We work to keep the site available but provide it &ldquo;as is&rdquo;, without warranties.
          We do not guarantee uninterrupted or error-free access.
        </p>
        <p>
          To the extent permitted by law, we are not liable for indirect or consequential loss, or for
          loss of profits, revenue or data, arising from your use of the site. Nothing here limits
          liability that cannot lawfully be limited.
        </p>
      </>
    ),
  },
  {
    heading: "Privacy",
    body: (
      <p>
        Our <a href="/privacy">Privacy Policy</a> explains what we collect and why. By using the site
        you agree to that policy.
      </p>
    ),
  },
  {
    heading: "Governing law",
    body: (
      <p>
        These terms are governed by the laws of Sri Lanka, and the courts of Sri Lanka have exclusive
        jurisdiction over any dispute arising from them.
      </p>
    ),
  },
  {
    heading: "Contact",
    body: (
      <p>
        Questions about these terms: <a href={`mailto:${SITE.email}`}>{SITE.email}</a>.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            pageSchema({
              path: "/terms",
              name: "Terms of Service",
              description: "The terms that apply to using flowstate.lk and engaging Flow State.",
              crumbs: [{ name: "Terms of Service", path: "/terms" }],
            }),
          ),
        }}
      />
      <LegalPage
        eyebrow="Legal"
        title="Terms of Service"
        updated={UPDATED}
        intro={
          <>
            The rules for using this site, and what a walkthrough does and doesn&apos;t commit either
            of us to. Paid work always runs on a separate signed agreement.
          </>
        }
        sections={SECTIONS}
      />
    </>
  );
}
