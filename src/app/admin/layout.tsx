import type { Metadata } from "next";
import type { ReactNode } from "react";
import ThemeController from "@/components/admin/theme/ThemeController";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Flow State Admin" },
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The admin sits outside the marketing chrome — no site nav, no footer — and
 * wears the theme each person picks in My account › Appearance.
 */
export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ink text-cream">
      <ThemeController />
      {children}
    </div>
  );
}
