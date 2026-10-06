"use client";

import { Icon } from "@/components/admin/icons";
import { Button } from "@/components/admin/ui";
import { toCSV, type CsvCell } from "@/lib/admin/reports";

/**
 * Print / PDF and Export CSV for a report. Printing uses the browser's own
 * dialog (Save as PDF) with the shared print stylesheet — the shell, tabs and
 * these buttons carry `.no-print`.
 */
export default function ReportActions({ rows, filename }: { rows: CsvCell[][]; filename: string }) {
  const exportCsv = () => {
    // BOM so Excel reads the rupee amounts and names as UTF-8.
    const blob = new Blob([`﻿${toCSV(rows)}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <Button className="min-h-9 sm:min-h-0" onClick={() => window.print()}>
        <Icon.printer size={13} /> Print / PDF
      </Button>
      <Button className="min-h-9 sm:min-h-0" onClick={exportCsv} disabled={rows.length <= 1}>
        <Icon.download size={13} /> Export CSV
      </Button>
    </div>
  );
}

/** The heading a printed report carries in place of the admin chrome. */
export function PrintTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-6 hidden print:block">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em]">Flow State · Reports</p>
      <h1 className="mt-1 font-display text-[22px] font-medium">{title}</h1>
      <p className="mt-0.5 text-[12px]">{sub}</p>
    </div>
  );
}
