import type { ReactNode } from "react";
import ScrollReveal from "@/components/ScrollReveal";

type Props = {
  eyebrow: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  align?: "left" | "center";
  /** Renders a smaller heading — for secondary sections. */
  size?: "lg" | "md";
  className?: string;
  /** Optional element rendered to the right of the heading on large screens (filters, links). */
  aside?: ReactNode;
};

/**
 * The page's standard section opener: eyebrow → display heading → sub copy.
 * Same rhythm everywhere so every page reads as one system.
 */
export default function SectionHead({
  eyebrow,
  title,
  sub,
  align = "left",
  size = "lg",
  className = "",
  aside,
}: Props) {
  const centered = align === "center";
  const heading =
    size === "lg"
      ? "text-4xl sm:text-5xl lg:text-6xl"
      : "text-3xl sm:text-4xl lg:text-[2.75rem]";

  const body = (
    <div className={`${centered ? "mx-auto text-center" : ""} max-w-3xl`}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 className={`font-display mt-4 text-balance font-medium leading-[1.05] text-cream ${heading}`}>{title}</h2>
      {sub && (
        <p
          className={`mt-5 max-w-2xl text-pretty text-base leading-relaxed text-cream-2 sm:text-lg ${
            centered ? "mx-auto" : ""
          }`}
        >
          {sub}
        </p>
      )}
    </div>
  );

  if (aside) {
    return (
      <ScrollReveal className={`flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between ${className}`}>
        {body}
        {aside}
      </ScrollReveal>
    );
  }
  return <ScrollReveal className={className}>{body}</ScrollReveal>;
}
