import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Sora } from "next/font/google";
import "./globals.css";
import SmoothScroll from "@/components/SmoothScroll";
import { SITE, jsonLd, organizationSchema } from "@/lib/site";
import { INTRO_BOOT_SCRIPT } from "@/lib/intro";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

// Only 400 (inherited) and 500 (`font-medium`) are used anywhere in the UI.
const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  authors: [
    { name: SITE.name, url: SITE.url },
    { name: "ARC AI", url: "https://www.arcai.agency" },
  ],
  creator: "ARC AI",
  publisher: SITE.name,
  alternates: { canonical: SITE.url },
  category: "technology",
  keywords: [
    "AI automation Sri Lanka",
    "business automation",
    "custom CRM Sri Lanka",
    "WhatsApp AI sales",
    "workflow automation",
    "AI systems for business",
    "Flow State",
  ],
  openGraph: {
    type: "website",
    url: SITE.url,
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    locale: SITE.locale,
    images: [{ url: "/og/default.png", width: 1200, height: 630, alt: `${SITE.name} — ${SITE.tagline}` }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    images: ["/og/default.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  // Icons come from the file conventions in src/app — favicon.ico, icon.png
  // and apple-icon.png. Next reads each file's real dimensions, so the `sizes`
  // it emits can't drift out of step with the artwork the way a hand-written
  // list does.
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  themeColor: "#0b0806",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${sora.variable} h-full antialiased`}
      // The boot scripts add `is-preloading` and the admin's `data-theme` before hydration on purpose.
      suppressHydrationWarning
    >
      <head>
        {/* Runs before the first paint — and before <body> is parsed — so the
            intro veil covers the home page from frame one rather than appearing
            once hydration reaches the preloader. The home page's own LCP
            preload is issued from `app/page.tsx`, which React hoists into this
            head ahead of the script. */}
        <script dangerouslySetInnerHTML={{ __html: INTRO_BOOT_SCRIPT }} />
        {/* Admin pages only: the chosen theme (My account › Appearance), before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <script
          type="application/ld+json"
          // Organization + WebSite: the identity every page's schema points back to.
          dangerouslySetInnerHTML={{ __html: jsonLd(organizationSchema()) }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <SmoothScroll>{children}</SmoothScroll>
        <div className="noise" aria-hidden />
      </body>
    </html>
  );
}
