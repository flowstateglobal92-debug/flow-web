import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { canAccess } from "@/lib/admin/modules";
import type { Inquiry, InquiryStatus, Stage } from "@/lib/admin/types";
import { PageHead } from "@/components/admin/ui";
import InquiriesTable from "./InquiriesTable";

export const metadata: Metadata = { title: "Inquiries" };

const TABS: { key: InquiryStatus | "all"; label: string }[] = [
  { key: "new", label: "New" },
  { key: "read", label: "Read" },
  { key: "converted", label: "In CRM" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
];

export default async function InquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; open?: string }>;
}) {
  const { supabase, profile } = await requireModule("inquiries");
  // Moving an inquiry into the CRM needs the CRM too; without it the buttons go.
  const canCrm = canAccess(profile, "crm");
  const { status = "new", q = "", open } = await searchParams;
  const tab = (TABS.find((t) => t.key === status)?.key ?? "new") as InquiryStatus | "all";

  const COLUMNS = "id, name, business, contact, focus, message, source, page, status, converted_lead_id, notes, created_at";
  let query = supabase
    .from("inquiries")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(300);

  if (tab !== "all") query = query.eq("status", tab);
  if (q.trim()) {
    const term = `%${q.trim()}%`;
    query = query.or(`name.ilike.${term},business.ilike.${term},contact.ilike.${term},message.ilike.${term}`);
  }

  const [{ data: inquiries }, { data: stages }, counts] = await Promise.all([
    query.returns<Inquiry[]>(),
    canCrm
      ? supabase
          .from("pipeline_stages")
          .select("id, name, slug, position, tone, is_protected, is_won, is_lost")
          .order("position", { ascending: true })
          .returns<Stage[]>()
      : Promise.resolve({ data: [] as Stage[] }),
    Promise.all(
      TABS.map(async (t) => {
        const base = supabase.from("inquiries").select("id", { count: "exact", head: true });
        const { count } = t.key === "all" ? await base : await base.eq("status", t.key);
        return [t.key, count ?? 0] as const;
      }),
    ),
  ]);

  const countBy = Object.fromEntries(counts) as Record<string, number>;

  // ?open= (a notification, ⌘K) may point outside the current tab — fetch it on its own.
  const wanted = open && /^[0-9a-f-]{36}$/i.test(open) ? open : null;
  const focus = wanted
    ? ((inquiries ?? []).find((i) => i.id === wanted) ??
      (await supabase.from("inquiries").select(COLUMNS).eq("id", wanted).maybeSingle<Inquiry>()).data ??
      null)
    : null;

  return (
    <>
      <PageHead
        eyebrow="Inbound"
        title="Inquiries"
        hint={
          canCrm
            ? "Every submission of the walkthrough form. Select the ones worth pursuing and push them straight into the CRM."
            : "Every submission of the walkthrough form — read them, keep notes, archive what's done."
        }
      />
      <InquiriesTable
        inquiries={inquiries ?? []}
        stages={stages ?? []}
        canCrm={canCrm}
        tabs={TABS.map((t) => ({ ...t, count: countBy[t.key] ?? 0 }))}
        activeTab={tab}
        query={q}
        focus={focus}
      />
    </>
  );
}
