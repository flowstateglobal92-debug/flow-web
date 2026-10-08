import type { ReactNode } from "react";
import { requireModule } from "@/lib/admin/auth";
import { Icon } from "@/components/admin/icons";
import { RouteTabs } from "@/components/admin/Tabs";
import { PageHead } from "@/components/admin/ui";

/**
 * P&L · Receivables aging · Cash-flow forecast. The numbers come from
 * definer RPCs (0022) that check Reports access themselves, so a member with
 * Reports but no ledger access still gets totals — never rows.
 */
export default async function ReportsLayout({ children }: { children: ReactNode }) {
  await requireModule("reports");
  return (
    <>
      <div className="no-print">
        <PageHead
          eyebrow="Money"
          title="Reports"
          hint="Approved numbers only. Print any report to PDF or take it to a spreadsheet as CSV."
        />
        <RouteTabs
          className="mb-5"
          tabs={[
            { href: "/admin/reports", label: "Profit & loss", exact: true, icon: <Icon.chart size={13} /> },
            { href: "/admin/reports/aging", label: "Receivables aging", icon: <Icon.clock size={13} /> },
            { href: "/admin/reports/cashflow", label: "Cash-flow forecast", icon: <Icon.ledger size={13} /> },
            { href: "/admin/reports/tax", label: "Tax", icon: <Icon.scale size={13} /> },
          ]}
        />
      </div>
      <div className="print-plain">{children}</div>
    </>
  );
}
