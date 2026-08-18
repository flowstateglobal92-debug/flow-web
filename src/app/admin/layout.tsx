import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Flow State Admin" },
  robots: { index: false, follow: false, nocache: true },
};

/** The admin sits outside the marketing chrome — no site nav, no footer. */
export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-ink text-cream">{children}</div>;
}
