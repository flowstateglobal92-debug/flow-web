"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { Avatar } from "./ui";
import Bell from "./notifications/Bell";
import { NotificationsProvider, type NotificationsInitial } from "./notifications/NotificationsProvider";
import CommandPalette, { SearchTrigger } from "./CommandPalette";
import RailStatus from "./RailStatus";
import { signOut } from "@/app/admin/actions/auth";
import { APPROVALS_NAV, MODULES, NAV_GROUPS, canAccess, type NavGroup } from "@/lib/admin/modules";
import { ROLE_LABEL, type ShellProfile } from "@/lib/admin/types";

export type ShellCounts = {
  /** New website inquiries. */
  inquiries?: number;
  /** Unread inbound mail (only fetched with email access). */
  mail?: number;
  /** My to-dos due today or overdue. */
  todos?: number;
  /** Requests waiting for my decision (approvers only). */
  approvals?: number;
};

type NavItem = { href: string; label: string; hint: string; icon: keyof typeof Icon; group: NavGroup };

export default function Shell({
  children,
  profile,
  counts = {},
  mailbox = "",
  notifications,
}: {
  children: ReactNode;
  profile: ShellProfile;
  counts?: ShellCounts;
  /** Address the mailbox sends and receives on — shown under the Email rail. */
  mailbox?: string;
  notifications: NotificationsInitial;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const demo = profile.workspace === "demo";

  const allowed: NavItem[] = MODULES.filter((m) => canAccess(profile, m.key)).map((m) => ({
    href: m.href,
    label: m.label,
    hint: m.hint,
    icon: m.icon,
    group: m.group,
  }));
  // Approvals is open to everyone and sits above Team & Users.
  const ordered: NavItem[] = NAV_GROUPS.flatMap((g) => [
    ...(g === "Admin" ? [APPROVALS_NAV] : []),
    ...allowed.filter((i) => i.group === g),
  ]);

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  const countFor = (href: string) =>
    ({
      "/admin/inquiries": counts.inquiries ?? 0,
      "/admin/email": counts.mail ?? 0,
      "/admin/todos": counts.todos ?? 0,
      "/admin/approvals": counts.approvals ?? 0,
    })[href] ?? 0;

  const hintFor = (item: NavItem) => (item.href === "/admin/email" ? mailbox || item.hint : item.hint);

  const nav = (
    <nav className="flex flex-col gap-4" aria-label="Admin">
      {NAV_GROUPS.map((group) => {
        const groupItems = ordered.filter((i) => i.group === group);
        if (groupItems.length === 0) return null;
        return (
          <div key={group}>
            <p className="mb-1.5 px-3 font-mono text-[9.5px] uppercase tracking-[0.22em] text-sand/60">{group}</p>
            <div className="flex flex-col gap-1">
              {groupItems.map((item) => {
                const active = isActive(item.href);
                const ItemIcon = Icon[item.icon];
                const count = countFor(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`group relative flex items-center gap-3 border px-3 py-2 transition-all duration-300 ${
                      active
                        ? "border-terra/40 bg-terra/[0.10] text-cream"
                        : "border-transparent text-sand hover:border-cream/12 hover:bg-cream/[0.04] hover:text-cream"
                    }`}
                  >
                    <span
                      className={`absolute inset-y-0 left-0 w-px transition-colors ${active ? "bg-terra" : "bg-transparent"}`}
                      aria-hidden
                    />
                    <span className={active ? "text-terra-bright" : "text-sand group-hover:text-cream-2"}>
                      <ItemIcon size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium leading-tight">{item.label}</span>
                      <span className="block truncate text-[10.5px] text-sand/80" data-nav-hint>
                        {hintFor(item)}
                      </span>
                    </span>
                    {count > 0 && (
                      <span className="shrink-0 bg-terra px-1.5 py-0.5 font-mono text-[10px] font-medium text-on-terra tabular-nums">
                        {count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );

  const name = profile.full_name || profile.email;
  const roleLabel = demo ? "Demo" : ROLE_LABEL[profile.role];

  const identity = (
    <div className="border-t border-cream/[0.08] px-3 pb-4 pt-3">
      <div className="flex items-center gap-2.5">
        <Link
          href="/admin/account"
          onClick={() => setOpen(false)}
          className="flex min-w-0 flex-1 items-center gap-2.5 transition-opacity hover:opacity-85"
          title="My account"
        >
          <Avatar name={name} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium text-cream">{name}</span>
            <span className="block truncate text-[10.5px] text-sand">
              {roleLabel}
              {profile.title ? ` · ${profile.title}` : ""}
            </span>
          </span>
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            aria-label="Sign out"
            title="Sign out"
            className="flex h-8 w-8 items-center justify-center text-sand transition-colors hover:bg-cream/10 hover:text-cream pointer-coarse:h-9 pointer-coarse:w-9"
          >
            <Icon.logout size={16} />
          </button>
        </form>
      </div>
    </div>
  );

  const brand = (
    <div className="flex items-center justify-between gap-2 px-3 pb-4 pt-4">
      <Link href="/admin" className="flex min-w-0 items-center gap-2.5">
        <Image
          src="/brand/mark-256.webp"
          alt=""
          width={250}
          height={256}
          priority
          sizes="30px"
          className="h-[30px] w-auto object-contain"
        />
        <span className="min-w-0">
          <span className="block font-display text-[14px] font-medium leading-none text-cream">Flow State</span>
          <span className="mt-1 block font-mono text-[9.5px] uppercase tracking-[0.22em] text-terra-bright">
            {demo ? "Demo" : "Control room"}
          </span>
        </span>
      </Link>
      <span className="flex shrink-0 items-center">
        <SearchTrigger />
        <Bell />
      </span>
    </div>
  );

  return (
    <NotificationsProvider userId={profile.id} initial={notifications}>
      <div className="relative min-h-screen">
        <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden data-shell-chrome>
          <div className="glow-terra absolute -left-[10%] top-[-10%] h-[40vh] w-[40vw] opacity-[0.13]" />
          <div className="glow-cream absolute bottom-[-15%] right-[-5%] h-[35vh] w-[30vw] opacity-[0.06]" />
        </div>

        {/* Desktop rail */}
        <aside
          data-shell-chrome
          className="fixed inset-y-0 left-0 z-40 hidden w-[236px] flex-col border-r border-cream/[0.08] bg-ink-2/80 backdrop-blur-xl lg:flex"
        >
          {brand}
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scroll-thin" data-lenis-prevent>
            {nav}
          </div>
          <RailStatus />
          {identity}
        </aside>

        {/* Mobile bar */}
        <header
          data-shell-chrome
          className="sticky top-0 z-40 flex items-center justify-between gap-2 border-b border-cream/[0.08] bg-ink-2/90 px-3 py-2 backdrop-blur-xl lg:hidden"
        >
          <Link href="/admin" className="flex min-w-0 items-center gap-2.5">
            <Image src="/brand/mark-256.webp" alt="" width={250} height={256} sizes="26px" className="h-[26px] w-auto" />
            <span className="truncate font-display text-[13.5px] font-medium text-cream">
              {demo ? "Demo" : "Control room"}
            </span>
          </Link>
          <span className="flex shrink-0 items-center gap-1.5">
            <SearchTrigger compact />
            <Bell compact />
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label="Menu"
              className="flex h-9 w-9 items-center justify-center border border-cream/12 text-cream-2 transition-colors hover:bg-cream/[0.06]"
            >
              {open ? <Icon.close size={17} /> : <Icon.dashboard size={17} />}
            </button>
          </span>
        </header>

        {/* Mobile drawer */}
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden" data-shell-chrome>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="absolute inset-0 cursor-default scrim backdrop-blur-[3px]"
            />
            <aside className="rise-in absolute inset-y-0 left-0 flex w-[264px] flex-col border-r border-cream/[0.10] bg-ink-2">
              <Link href="/admin" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3 pb-4 pt-4">
                <Image src="/brand/mark-256.webp" alt="" width={250} height={256} sizes="30px" className="h-[30px] w-auto" />
                <span className="font-display text-[14px] font-medium text-cream">Flow State</span>
              </Link>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" data-lenis-prevent>
                {nav}
              </div>
              <RailStatus />
              {identity}
            </aside>
          </div>
        )}

        <div className="relative lg:pl-[236px]">
          {demo && (
            <div
              data-shell-chrome
              className="flex items-center justify-center gap-2 border-b border-terra/30 bg-terra/[0.10] px-4 py-1.5 text-center text-[11.5px] text-cream-2"
            >
              <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-terra-bright">Demo workspace</span>
              <span className="hidden sm:inline">Sample data only — explore freely, it resets automatically.</span>
            </div>
          )}
          <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
        </div>

        <CommandPalette profile={profile} />
      </div>
    </NotificationsProvider>
  );
}
