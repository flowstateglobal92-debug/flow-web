import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin/auth";
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
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { status = "new", q = "" } = await searchParams;
  const tab = (TABS.find((t) => t.key === status)?.key ?? "new") as InquiryStatus | "all";

  let query = supabase
    .from("inquiries")
    .select("id, name, business, contact, focus, message, source, page, status, converted_lead_id, notes, created_at")
    .order("created_at", { ascending: false })
    .limit(300);

  if (tab !== "all") query = query.eq("status", tab);
  if (q.trim()) {
    const term = `%${q.trim()}%`;
    query = query.or(`name.ilike.${term},business.ilike.${term},contact.ilike.${term},message.ilike.${term}`);
  }

  const [{ data: inquiries }, { data: stages }, counts] = await Promise.all([
    query.returns<Inquiry[]>(),
    supabase
      .from("pipeline_stages")
      .select("id, name, slug, position, tone, is_protected, is_won, is_lost")
      .order("position", { ascending: true })
      .returns<Stage[]>(),
    Promise.all(
      TABS.map(async (t) => {
        const base = supabase.from("inquiries").select("id", { count: "exact", head: true });
        const { count } = t.key === "all" ? await base : await base.eq("status", t.key);
        return [t.key, count ?? 0] as const;
      }),
    ),
  ]);

  const countBy = Object.fromEntries(counts) as Record<string, number>;

  return (
    <>
      <PageHead
        eyebrow="Inbound"
        title="Inquiries"
        hint="Every submission of the walkthrough form. Select the ones worth pursuing and push them straight into the CRM."
      />
      <InquiriesTable
        inquiries={inquiries ?? []}
        stages={stages ?? []}
        tabs={TABS.map((t) => ({ ...t, count: countBy[t.key] ?? 0 }))}
        activeTab={tab}
        query={q}
      />
    </>
  );
}
