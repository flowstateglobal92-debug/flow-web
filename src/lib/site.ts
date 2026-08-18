import type { Metadata } from "next";

/**
 * Single source of truth for anything that has to agree across metadata,
 * structured data, the sitemap and the footer.
 */
export const SITE = {
  name: "Flow State",
  legalName: "Flow State",
  url: "https://flowstate.lk",
  locale: "en_LK",
  email: "support@flowstate.lk",
  /** Phone intentionally omitted until the number is confirmed. */
  phone: "",
  country: "LK",
  region: "Sri Lanka",
  tagline: "AI systems that put your business in flow",
  description:
    "Flow State designs custom AI and automation systems for owner-led businesses — one shared record, one automation engine, one command surface — so routine work runs itself.",
  languages: ["English", "Sinhala", "Tamil"],
} as const;

export const ROUTES = [
  { path: "/", changeFrequency: "weekly" as const, priority: 1.0 },
  { path: "/solution", changeFrequency: "weekly" as const, priority: 0.9 },
  { path: "/about", changeFrequency: "monthly" as const, priority: 0.8 },
  { path: "/contact", changeFrequency: "monthly" as const, priority: 0.8 },
  { path: "/privacy", changeFrequency: "yearly" as const, priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly" as const, priority: 0.3 },
];

export const abs = (path: string) => new URL(path, SITE.url).toString();

/** Per-page metadata with canonical + OG/Twitter wired to the page's own image. */
export function pageMeta({
  title,
  description,
  path,
  image = "/og/default.png",
  keywords,
  absoluteTitle = false,
}: {
  title: string;
  description: string;
  path: string;
  image?: string;
  keywords?: string[];
  /** Skip the `%s · Flow State` template — for the home page, which names the brand itself. */
  absoluteTitle?: boolean;
}): Metadata {
  const url = abs(path);
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    keywords,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      siteName: SITE.name,
      title,
      description,
      locale: SITE.locale,
      images: [{ url: image, width: 1200, height: 630, alt: `${SITE.name} — ${title}` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

/** Organization + WebSite — emitted once, in the root layout. */
export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": abs("/#organization"),
        name: SITE.name,
        legalName: SITE.legalName,
        url: SITE.url,
        description: SITE.description,
        email: SITE.email,
        logo: {
          "@type": "ImageObject",
          "@id": abs("/#logo"),
          url: abs("/brand/mark-256.png"),
          width: 250,
          height: 256,
        },
        image: abs("/og/default.png"),
        address: {
          "@type": "PostalAddress",
          addressCountry: SITE.country,
          addressRegion: SITE.region,
        },
        areaServed: { "@type": "Country", name: "Sri Lanka" },
        knowsLanguage: [...SITE.languages],
        contactPoint: [
          {
            "@type": "ContactPoint",
            contactType: "sales",
            email: SITE.email,
            availableLanguage: [...SITE.languages],
            areaServed: SITE.country,
          },
        ],
      },
      {
        "@type": "WebSite",
        "@id": abs("/#website"),
        url: SITE.url,
        name: SITE.name,
        description: SITE.description,
        publisher: { "@id": abs("/#organization") },
        inLanguage: "en",
      },
    ],
  };
}

/** WebPage + breadcrumb trail for an inner route. */
export function pageSchema({
  path,
  name,
  description,
  crumbs,
}: {
  path: string;
  name: string;
  description: string;
  /** Trail after Home, e.g. [{ name: "Our solution", path: "/solution" }] */
  crumbs?: { name: string; path: string }[];
}) {
  const items = [{ name: "Home", path: "/" }, ...(crumbs ?? [])];
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": abs(`${path}#webpage`),
        url: abs(path),
        name,
        description,
        isPartOf: { "@id": abs("/#website") },
        about: { "@id": abs("/#organization") },
        inLanguage: "en",
        primaryImageOfPage: { "@type": "ImageObject", url: abs("/og/default.png") },
      },
      {
        "@type": "BreadcrumbList",
        "@id": abs(`${path}#breadcrumbs`),
        itemListElement: items.map((c, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: c.name,
          item: abs(c.path),
        })),
      },
    ],
  };
}

/** Serialise JSON-LD safely for embedding in a <script> tag. */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
