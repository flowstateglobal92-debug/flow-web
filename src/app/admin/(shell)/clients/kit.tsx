import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A link dressed as the admin <Button>. Cross-module jumps (Create quote, View
 * client, Open lead) are real links so they open in a new tab and survive a
 * refresh. Touch pointers get a 36px target.
 */
export function LinkButton({
  href,
  variant = "ghost",
  children,
  className = "",
}: {
  href: string;
  variant?: "primary" | "ghost";
  children: ReactNode;
  className?: string;
}) {
  const looks =
    variant === "primary"
      ? "btn btn--primary"
      : "border border-cream/12 bg-cream/[0.03] text-cream-2 hover:border-cream/30 hover:bg-cream/[0.06] hover:text-cream";
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-1.5 rounded-none px-3 py-1.5 text-[12px] font-medium transition-all duration-300 pointer-coarse:min-h-9 ${looks} ${className}`}
    >
      {children}
    </Link>
  );
}

/** The filter pill used by the board and the client list (same look as Tabs). */
export const pillClass = (active: boolean) =>
  `inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors duration-300 pointer-coarse:min-h-9 ${
    active
      ? "border-terra/50 bg-terra/15 text-terra-bright"
      : "border-cream/12 bg-cream/[0.03] text-cream-2 hover:border-cream/30 hover:text-cream"
  }`;
