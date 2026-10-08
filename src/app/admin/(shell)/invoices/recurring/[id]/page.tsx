import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireModule } from "@/lib/admin/auth";
import { todayISO } from "@/lib/admin/format";
import { canAccess, isApprover } from "@/lib/admin/modules";
import { displayName } from "@/lib/admin/team";
import { Icon } from "@/components/admin/icons";
import InvoiceEditor from "@/components/admin/invoice/InvoiceEditor";
import { cadenceLabel, editorDocFromSchedule, scheduleDraftFrom, type InvoiceSchedule } from "@/lib/admin/invoice-types";
import { loadClients, loadEditorExtras, loadInvoicePeople, loadLeads, loadSettings } from "../../data";

export const metadata: Metadata = { title: "Recurring template" };

/** A schedule's lines and bill-to, in the full editor, with its cadence below. */
export default async function ScheduleTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, profile } = await requireModule("invoices");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { data: schedule } = await supabase.from("invoice_schedules").select("*").eq("id", id).maybeSingle<InvoiceSchedule>();
  if (!schedule) notFound();

  const [settings, clients, leads, owners, extras] = await Promise.all([
    loadSettings(supabase, profile.workspace),
    loadClients(supabase),
    loadLeads(supabase, profile),
    loadInvoicePeople(supabase, profile),
    loadEditorExtras(supabase),
  ]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/admin/invoices/recurring"
          className="inline-flex min-h-9 items-center gap-1.5 text-[12px] text-sand transition-colors hover:text-cream"
        >
          <Icon.chevronLeft size={14} /> Recurring
        </Link>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-sand">
          {schedule.name} · {cadenceLabel(schedule.frequency, schedule.interval_count)}
        </p>
      </div>
      <InvoiceEditor
        mode="schedule"
        initial={editorDocFromSchedule(schedule, settings)}
        schedule={{ id: schedule.id, draft: scheduleDraftFrom(schedule) }}
        settings={settings}
        clients={clients}
        leads={leads}
        owners={owners.map((o) => ({ id: o.id, name: displayName(o) }))}
        viewer={{ id: profile.id, admin: isApprover(profile), canClients: canAccess(profile, "clients") }}
        today={todayISO()}
        {...extras}
      />
    </>
  );
}
