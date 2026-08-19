"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { Avatar } from "./ui";
import { signOut } from "@/app/admin/actions/auth";

const NAV = [
  { href: "/admin", label: "Dashboard", hint: "Today at a glance", icon: Icon.dashboard },
  { href: "/admin/inquiries", label: "Inquiries", hint: "Form submissions", icon: Icon.inbox },
  { href: "/admin/email", label: "Email", hint: "", icon: Icon.mail },
  { href: "/admin/crm", label: "CRM", hint: "Kanban pipeline", icon: Icon.pipeline },
  { href: "/admin/expenses", label: "Expenses", hint: "Income & profit", icon: Icon.ledger },
] as const;

export default function Shell({
  children,
  name,
  email,
  newInquiries = 0,
  unreadMail = 0,
  mailbox = "",
}: {
  children: ReactNode;
  name: string;
  email: string;
  newInquiries?: number;
  unreadMail?: number;
  /** Address the mailbox sends and receives on — shown under the Email rail. */
  mailbox?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  /** Only two rails carry a count, and both mean "unopened". */
  const countFor = (href: string) =>
    href === "/admin/inquiries" ? newInquiries : href === "/admin/email" ? unreadMail : 0;

  const nav = (
    <nav className="flex flex-col gap-1" aria-label="Admin">
      {NAV.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={`group relative flex items-center gap-3 border px-3 py-2.5 transition-all duration-300 ${active
                ? "border-terra/40 bg-terra/[0.10] text-cream"
                : "border-transparent text-sand hover:border-cream/12 hover:bg-cream/[0.04] hover:text-cream"
              }`}
          >
            <span
              className={`absolute inset-y-0 left-0 w-px transition-colors ${active ? "bg-terra" : "bg-transparent"}`}
              aria-hidden
            />
            <span className={active ? "text-terra-bright" : "text-sand group-hover:text-cream-2"}>
              <item.icon size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium leading-tight">{item.label}</span>
              <span className="block text-[10.5px] text-sand/80">
                {item.href === "/admin/email" ? mailbox || "Inbox & sent" : item.hint}
              </span>
            </span>
            {countFor(item.href) > 0 && (
              <span className="shrink-0 bg-terra px-1.5 py-0.5 font-mono text-[10px] font-medium text-cream tabular-nums">
                {countFor(item.href)}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const identity = (
    <div className="border-t border-cream/[0.08] px-3 pb-4 pt-3">
      <div className="flex items-center gap-2.5">
        <Avatar name={name || email} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium text-cream">{name || "Admin"}</p>
          <p className="truncate text-[10.5px] text-sand">{email}</p>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            aria-label="Sign out"
            title="Sign out"
            className="flex h-8 w-8 items-center justify-center text-sand transition-colors hover:bg-cream/10 hover:text-cream"
          >
            <Icon.logout size={16} />
          </button>
        </form>
      </div>
    </div>
  );

  const brand = (
    <Link href="/admin" className="flex items-center gap-2.5 px-3 pb-4 pt-4">
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
          Control room
        </span>
      </span>
    </Link>
  );

  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="glow-terra absolute -left-[10%] top-[-10%] h-[40vh] w-[40vw] opacity-[0.13]" />
        <div className="glow-cream absolute bottom-[-15%] right-[-5%] h-[35vh] w-[30vw] opacity-[0.06]" />
      </div>

      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[236px] flex-col border-r border-cream/[0.08] bg-ink-2/80 backdrop-blur-xl lg:flex">
        {brand}
        <div className="flex-1 overflow-y-auto px-2 scroll-thin" data-lenis-prevent>
          {nav}
        </div>
        {identity}
      </aside>

      {/* Mobile bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-cream/[0.08] bg-ink-2/90 px-3 py-2 backdrop-blur-xl lg:hidden">
        <Link href="/admin" className="flex items-center gap-2.5">
          <Image src="/brand/mark-256.webp" alt="" width={250} height={256} sizes="26px" className="h-[26px] w-auto" />
          <span className="font-display text-[13.5px] font-medium text-cream">Control room</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Menu"
          className="flex h-9 w-9 items-center justify-center border border-cream/12 text-cream-2 transition-colors hover:bg-cream/[0.06]"
        >
          {open ? <Icon.close size={17} /> : <Icon.dashboard size={17} />}
        </button>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-ink/80 backdrop-blur-[3px]"
          />
          <aside className="rise-in absolute inset-y-0 left-0 flex w-[264px] flex-col border-r border-cream/[0.10] bg-ink-2">
            {brand}
            <div className="flex-1 overflow-y-auto px-2">{nav}</div>
            {identity}
          </aside>
        </div>
      )}

      <div className="relative lg:pl-[236px]">
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
