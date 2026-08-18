import LegalPage, { type LegalSection } from "@/components/sections/legal/LegalPage";
import { SITE, jsonLd, pageMeta, pageSchema } from "@/lib/site";

export const metadata = pageMeta({
  title: "Privacy Policy",
  description:
    "How Flow State collects, uses, stores and protects personal data on flowstate.lk and in the systems we build for clients.",
  path: "/privacy",
  image: "/og/privacy.png",
});

const UPDATED = "17 August 2026";

const SECTIONS: LegalSection[] = [
  {
    heading: "Who we are",
    body: (
      <>
        <p>
          Flow State (&ldquo;we&rdquo;, &ldquo;us&rdquo;) designs custom AI and automation systems for
          businesses. This policy covers <strong>flowstate.lk</strong> and the enquiries you send us
          through it.
        </p>
        <p>
          It does not cover the systems we build and operate for a client — in those, the client is
          the data controller and their own privacy policy applies. We act as a processor under our
          agreement with them.
        </p>
      </>
    ),
  },
  {
    heading: "What we collect",
    body: (
      <>
        <p>We only collect what you choose to send us:</p>
        <ul>
          <li>
            <strong>Enquiry details</strong> — your name, business name, email address or WhatsApp
            number, and whatever you write in the message or select as your focus area.
          </li>
          <li>
            <strong>Correspondence</strong> — the emails and messages we exchange with you afterwards.
          </li>
        </ul>
        <p>
          We do not run advertising trackers, we do not sell data, and we do not build profiles on
          visitors. The site sets no marketing or analytics cookies.
        </p>
      </>
    ),
  },
  {
    heading: "Why we use it",
    body: (
      <>
        <p>Your details are used to:</p>
        <ul>
          <li>reply to your enquiry and arrange a walkthrough;</li>
          <li>prepare the automation map we discuss on that call;</li>
          <li>keep a record of what was agreed if we go on to work together.</li>
        </ul>
        <p>
          The lawful basis is your consent when you contact us, and our legitimate interest in
          responding to business enquiries. We will not add you to a mailing list from a walkthrough
          request.
        </p>
      </>
    ),
  },
  {
    heading: "How long we keep it",
    body: (
      <p>
        Enquiries that do not become projects are deleted within <strong>24 months</strong>. Records
        connected to a signed engagement are kept for as long as the engagement runs and for a further
        seven years where tax or contract law requires it.
      </p>
    ),
  },
  {
    heading: "Who else sees it",
    body: (
      <>
        <p>
          Only the people at Flow State working on your enquiry, plus the service providers that run
          our email and hosting. Those providers process data on our instructions under contract.
        </p>
        <p>
          We may disclose information if the law requires it. We never sell or rent personal data to
          anyone.
        </p>
      </>
    ),
  },
  {
    heading: "Where it is stored",
    body: (
      <p>
        Our email and hosting providers may store data on servers outside Sri Lanka. Where that
        happens we rely on providers that offer appropriate contractual safeguards for international
        transfers.
      </p>
    ),
  },
  {
    heading: "Your rights",
    body: (
      <>
        <p>
          You can ask us to give you a copy of the personal data we hold about you, correct it, delete
          it, or stop using it. Write to{" "}
          <a href={`mailto:${SITE.email}`}>{SITE.email}</a> and we will respond within 30 days.
        </p>
        <p>
          If you are unhappy with how we have handled your data, tell us first — we would rather fix
          it directly — and you retain the right to complain to the relevant data protection authority.
        </p>
      </>
    ),
  },
  {
    heading: "Security",
    body: (
      <p>
        Access to enquiry data is limited to the team members who need it, protected by
        multi-factor authentication, and transmitted over encrypted connections. No system is
        perfectly secure, but we will tell you promptly if a breach affects your data.
      </p>
    ),
  },
  {
    heading: "Changes to this policy",
    body: (
      <p>
        If this policy changes materially we will update the date at the top of this page. Continuing
        to use the site after a change means you accept the updated policy.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            pageSchema({
              path: "/privacy",
              name: "Privacy Policy",
              description: "How Flow State collects, uses, stores and protects personal data.",
              crumbs: [{ name: "Privacy Policy", path: "/privacy" }],
            }),
          ),
        }}
      />
      <LegalPage
        eyebrow="Legal"
        title="Privacy Policy"
        updated={UPDATED}
        intro={
          <>
            We keep this short and specific, because a privacy policy you can&apos;t read protects
            nobody. In plain terms: we collect only what you send us, we use it only to answer you,
            and we never sell it.
          </>
        }
        sections={SECTIONS}
      />
    </>
  );
}
