import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { todayISO } from "@/lib/admin/format";
import { isApprover } from "@/lib/admin/modules";
import { displayName, loadTeam } from "@/lib/admin/team";
import type { Invoice, InvoiceSchedule } from "@/lib/admin/invoice-types";
import RecurringList from "./RecurringList";
import { runRecurring } from "../data";

export const metadata: Metadata = { title: "Recurring invoices" };

/** Schedules and retainers. `?open=<id>` opens that schedule's settings. */
export default async function RecurringPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const { supabase, profile } = await requireModule("invoices");
  const { open } = await searchParams;

  // Anything due generates before the list renders, so "next run" is never in the past.
  const generated = await runRecurring(supabase);

  const [{ data: schedules }, team] = await Promise.all([
    supabase
      .from("invoice_schedules")
      .select("*")
      .order("active", { ascending: false })
      .order("next_run_on", { ascending: true })
      .returns<InvoiceSchedule[]>(),
    loadTeam(supabase),
  ]);

  const lastIds = (schedules ?? []).map((s) => s.last_invoice_id).filter((x): x is string => !!x);
  const { data: last } = lastIds.length
    ? await supabase.from("invoices").select("id, number, status").in("id", lastIds).returns<Pick<Invoice, "id" | "number" | "status">[]>()
    : { data: [] as Pick<Invoice, "id" | "number" | "status">[] };

  return (
    <RecurringList
      key={open ?? ""}
      schedules={schedules ?? []}
      lastInvoices={Object.fromEntries((last ?? []).map((i) => [i.id, i.number ?? "Draft"]))}
      people={Object.fromEntries(team.map((m) => [m.id, displayName(m)]))}
      openId={open ?? null}
      generated={generated}
      today={todayISO()}
      admin={isApprover(profile)}
    />
  );
}
