import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireModule } from "@/lib/admin/auth";
import { todayISO } from "@/lib/admin/format";
import { canAccess } from "@/lib/admin/modules";
import { isDay } from "@/lib/admin/reports";
import { Icon } from "@/components/admin/icons";
import { Notice } from "@/components/admin/ui";
import { STATEMENT_PRESETS, readStatement, statementRange, type StatementPreset } from "@/lib/admin/statement";
import StatementScreen from "./StatementScreen";

export const metadata: Metadata = { title: "Statement" };

/**
 * A client's statement of account (0037) for a period and currency, with PDF,
 * email and print. Under Invoices: it's invoice money, whoever's client it is.
 */
export default async function StatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ client: string }>;
  searchParams: Promise<{ period?: string; from?: string; to?: string; currency?: string }>;
}) {
  const { supabase, profile } = await requireModule("invoices");
  const [{ client }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(client)) notFound();
  const today = todayISO();

  const { data: cfg } = await supabase
    .from("invoice_settings")
    .select("fiscal_year_start_month")
    .eq("workspace", profile.workspace)
    .maybeSingle<{ fiscal_year_start_month: number | null }>();
  const preset: StatementPreset =
    sp.period === "custom" && isDay(sp.from) && isDay(sp.to) && sp.from <= sp.to
      ? "custom"
      : STATEMENT_PRESETS.some((p) => p.value === sp.period)
        ? (sp.period as StatementPreset)
        : "tax_year";
  const range = preset === "custom" ? { from: sp.from!, to: sp.to! } : statementRange(preset, today, cfg?.fiscal_year_start_month ?? 4);

  const { data, error } = await supabase.rpc("client_statement", {
    p_client: client,
    p_from: range.from,
    p_to: range.to,
    p_currency: sp.currency || null,
  });
  const statement = error ? null : readStatement(data);

  return (
    <div className="space-y-4">
      <Link
        href={canAccess(profile, "clients") ? `/admin/clients/${client}` : "/admin/invoices"}
        className="no-print inline-flex min-h-9 items-center gap-1.5 text-[12px] text-sand transition-colors hover:text-cream"
      >
        <Icon.chevronLeft size={14} /> {statement ? statement.client.company || statement.client.name : "Back"}
      </Link>
      {!statement ? (
        <Notice tone="warn" title="The statement isn't available">
          {error?.message ?? "That client isn't available."}
        </Notice>
      ) : (
        <StatementScreen statement={statement} preset={preset} />
      )}
    </div>
  );
}
