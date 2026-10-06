import { Badge } from "@/components/admin/ui";
import { STATUS_META, displayStatus, type Invoice } from "@/lib/admin/invoice-types";

/** Links that look like the kit's Button (which is a <button> only). */
export const linkButton = {
  primary:
    "btn btn--primary inline-flex items-center justify-center gap-1.5 rounded-none px-3 py-1.5 text-[12px] font-medium transition-all duration-300",
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-none border border-cream/12 bg-cream/[0.03] px-3 py-1.5 text-[12px] font-medium text-cream-2 transition-all duration-300 hover:border-cream/30 hover:bg-cream/[0.06] hover:text-cream",
} as const;

/** The admin-side status pill (the paper has its own stamp). */
export function StatusBadge({
  doc,
  today,
}: {
  doc: Pick<Invoice, "kind" | "status" | "due_date" | "total" | "amount_paid"> & { valid_until?: string | null };
  today: string;
}) {
  const meta = STATUS_META[displayStatus(doc, today)] ?? STATUS_META.draft;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
