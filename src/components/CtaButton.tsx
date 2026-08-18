import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  href: string;
  variant?: "solid" | "ghost";
  className?: string;
};

/**
 * Stationary call-to-action. The button never moves on hover — instead the
 * solid variant sends a sheen of light across itself and the ghost variant
 * fills from the left, while the arrow glides forward.
 *
 * Same-page anchors stay plain `<a>` so the smooth-scroll handler owns them;
 * route links use `next/link` for prefetching and client transitions.
 */
export default function CtaButton({ children, href, variant = "solid", className = "" }: Props) {
  const skin = variant === "solid" ? "btn--primary" : "btn--ghost";
  const cls = `btn btn--anim ${skin} px-7 py-4 ${className}`;
  const inner = (
    <>
      <span className="btn__label">{children}</span>
      <svg className="btn__arrow" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </>
  );
  if (href.startsWith("#")) {
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}
