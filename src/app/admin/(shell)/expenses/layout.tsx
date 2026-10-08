import type { ReactNode } from "react";
import { requireModule } from "@/lib/admin/auth";
import { Icon } from "@/components/admin/icons";
import { RouteTabs } from "@/components/admin/Tabs";
import { PageHead } from "@/components/admin/ui";

/** Ledger · Bills · Suppliers · Bank · Budgets. Each page gates itself too — layouts don't re-run on client navigation. */
export default async function ExpensesLayout({ children }: { children: ReactNode }) {
  await requireModule("finance");
  return (
    <>
      <PageHead
        eyebrow="Books"
        title="Expenses & income"
        hint="One permanent ledger for the business. Every expense subtracts, every payment adds — profit and loss follows automatically and goes negative when it should."
      />
      <RouteTabs
        className="mb-5"
        tabs={[
          { href: "/admin/expenses", label: "Ledger", exact: true, icon: <Icon.ledger size={13} /> },
          { href: "/admin/expenses/bills", label: "Bills", icon: <Icon.receipt size={13} /> },
          { href: "/admin/expenses/suppliers", label: "Suppliers", icon: <Icon.building size={13} /> },
          { href: "/admin/expenses/bank", label: "Bank", icon: <Icon.link size={13} /> },
          { href: "/admin/expenses/budgets", label: "Budgets", icon: <Icon.scale size={13} /> },
        ]}
      />
      {children}
    </>
  );
}
