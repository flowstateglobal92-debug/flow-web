"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The admin's tab strip, in two flavours:
 *  - <RouteTabs> for tabs that are routes (Invoices → Create / Issued / Quotes)
 *  - <Tabs> for local state (a view toggle inside one page)
 * Same look as the Expenses kind filter it replaces.
 */

const base =
  "inline-flex shrink-0 items-center gap-1.5 border px-3 py-1.5 text-[12px] font-medium transition-colors duration-300 pointer-coarse:min-h-9";
const on = "border-terra/50 bg-terra/15 text-terra-bright";
const off = "border-cream/12 bg-cream/[0.03] text-cream-2 hover:border-cream/30 hover:text-cream";

export type RouteTab = {
  href: string;
  label: string;
  count?: number;
  icon?: ReactNode;
  /** Exact = active only on this path; default is prefix match (except the first tab). */
  exact?: boolean;
  /** Active when this search param equals `value` (for ?tab= style tabs). */
  param?: { key: string; value: string; isDefault?: boolean };
  /** Paths under this tab's prefix that belong to none of the tabs (a settings page, say). */
  not?: string[];
};

export function RouteTabs({ tabs, className = "" }: { tabs: RouteTab[]; className?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();

  const isActive = (t: RouteTab) => {
    const path = t.href.split("?")[0];
    if (t.param) {
      const v = search.get(t.param.key);
      return pathname === path && (v === t.param.value || (!v && !!t.param.isDefault));
    }
    if (t.exact) return pathname === path;
    if (t.not?.some((n) => pathname === n || pathname.startsWith(`${n}/`))) return false;
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  // The most specific match wins, so /invoices doesn't light up on /invoices/quotes.
  const active = tabs
    .filter(isActive)
    .sort((a, b) => b.href.length - a.href.length)[0];

  return (
    <nav className={`scroll-x -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 ${className}`} aria-label="Sections">
      {tabs.map((t) => {
        const current = t === active;
        return (
          <Link key={t.href} href={t.href} aria-current={current ? "page" : undefined} className={`${base} ${current ? on : off}`}>
            {t.icon}
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="font-mono text-[10px] tabular-nums opacity-80">{t.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
  className = "",
  size = "sm",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; count?: number; icon?: ReactNode }[];
  className?: string;
  size?: "xs" | "sm";
}) {
  return (
    <div role="tablist" className={`flex flex-wrap gap-1.5 ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`${base} ${size === "xs" ? "px-2.5 py-1 text-[11.5px]" : ""} ${o.value === value ? on : off}`}
        >
          {o.icon}
          {o.label}
          {o.count !== undefined && o.count > 0 && (
            <span className="font-mono text-[10px] tabular-nums opacity-80">{o.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
