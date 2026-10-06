import Link from "next/link";
import type { ReactNode } from "react";
import { requireModule } from "@/lib/admin/auth";
import { isApprover } from "@/lib/admin/modules";
import { NEW } from "@/lib/admin/links";
import { Icon } from "@/components/admin/icons";
import { RouteTabs } from "@/components/admin/Tabs";
import { PageHead } from "@/components/admin/ui";
import SettingsButton from "@/components/admin/invoice/SettingsButton";
import { linkButton } from "@/components/admin/invoice/parts";
import { loadSettings } from "./data";

/**
 * Invoices chrome: header, the four tabs and (for admins) the settings gear.
 * Layouts don't re-run on client navigation, so every page below checks
 * `requireModule("invoices")` itself too.
 */
export default async function InvoicesLayout({ children }: { children: ReactNode }) {
  const { supabase, profile } = await requireModule("invoices");
  const admin = isApprover(profile);

  const [settings, drafts] = await Promise.all([
    admin ? loadSettings(supabase, profile.workspace) : Promise.resolve(null),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "draft"),
  ]);

  return (
    <>
      {/* Screen only — ⌘P on an invoice prints just the paper. */}
      <div className="no-print">
        <PageHead
          eyebrow="Money"
          title="Invoices"
          hint="Quotes, invoices and retainers. Payments post to Income in Expenses automatically."
          actions={
            <>
              {settings && <SettingsButton settings={settings} />}
              <Link href={NEW.quote()} className={`${linkButton.ghost} min-h-9`}>
                <Icon.note size={13} /> New quote
              </Link>
              <Link href={NEW.invoice()} className={`${linkButton.primary} min-h-9`}>
                <Icon.plus size={13} /> New invoice
              </Link>
            </>
          }
        />
        <RouteTabs
          className="mb-5"
          tabs={[
            { href: "/admin/invoices/new", label: "Create invoice", icon: <Icon.plus size={13} />, count: drafts.count ?? 0 },
            { href: "/admin/invoices", label: "Issued invoices", icon: <Icon.receipt size={13} /> },
            { href: "/admin/invoices/quotes", label: "Quotes", icon: <Icon.note size={13} /> },
            { href: "/admin/invoices/recurring", label: "Recurring", icon: <Icon.repeat size={13} /> },
          ]}
        />
      </div>
      {children}
    </>
  );
}
