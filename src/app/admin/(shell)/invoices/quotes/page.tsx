import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { todayISO } from "@/lib/admin/format";
import { canAccess } from "@/lib/admin/modules";
import type { Invoice } from "@/lib/admin/invoice-types";
import QuotesList, { type QuoteFilter } from "./QuotesList";
import { searchTerm } from "../data";

export const metadata: Metadata = { title: "Quotes" };

const FILTERS: QuoteFilter[] = ["open", "accepted", "converted", "closed", "all"];

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; mine?: string; q?: string }>;
}) {
  const { supabase, profile } = await requireModule("invoices");
  const sp = await searchParams;
  const status = (FILTERS.includes(sp.status as QuoteFilter) ? sp.status : "open") as QuoteFilter;
  const mine = sp.mine === "1";
  const q = searchTerm(sp.q ?? "");
  const today = todayISO();

  let query = supabase
    .from("invoices")
    .select("*")
    .eq("kind", "quote")
    .order("issue_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(300);

  // Nothing stores "expired": a sent quote past its valid-until date reads as
  // expired (displayStatus), so it's closed here, not open.
  let statusOr: string | null = null;
  if (status === "open") statusOr = `status.eq.draft,and(status.eq.sent,or(valid_until.is.null,valid_until.gte.${today}))`;
  else if (status === "accepted") query = query.eq("status", "accepted");
  else if (status === "converted") query = query.eq("status", "converted");
  else if (status === "closed") statusOr = `status.in.(declined,expired),and(status.eq.sent,valid_until.lt.${today})`;

  if (mine) query = query.eq("owner_id", profile.id);
  const t = `%${q}%`;
  const searchOr = q ? `number.ilike.${t},bill_to_name.ilike.${t},bill_to_company.ilike.${t},subject.ilike.${t}` : null;
  // One `or` parameter: both conditions must hold when both are set.
  if (statusOr && searchOr) query = query.or(`and(or(${statusOr}),or(${searchOr}))`);
  else if (statusOr ?? searchOr) query = query.or((statusOr ?? searchOr)!);

  const [{ data: quotes }, { data: pipeline }] = await Promise.all([
    query.returns<Invoice[]>(),
    supabase
      .from("invoices")
      .select("status, total, currency, valid_until")
      .eq("kind", "quote")
      .in("status", ["sent", "accepted", "converted", "declined"])
      .limit(2000)
      .returns<Pick<Invoice, "status" | "total" | "currency" | "valid_until">[]>(),
  ]);

  // Pipeline figures in rupees; quotes in other currencies are counted, not summed.
  // A sent quote past its valid-until date has lapsed — no longer out with the client.
  const rows = (pipeline ?? []).filter((r) => !(r.status === "sent" && r.valid_until && r.valid_until < today));
  const sum = (st: string) =>
    rows.filter((r) => r.status === st && r.currency === "LKR").reduce((a, r) => a + Number(r.total ?? 0), 0);
  const count = (st: string) => rows.filter((r) => r.status === st).length;
  const won = count("accepted") + count("converted");
  const decided = won + count("declined");

  return (
    <QuotesList
      quotes={quotes ?? []}
      status={status}
      mine={mine}
      query={sp.q ?? ""}
      today={today}
      canCrm={canAccess(profile, "crm")}
      summary={{
        sent: { total: sum("sent"), count: count("sent") },
        accepted: { total: sum("accepted"), count: count("accepted") },
        winRate: decided ? Math.round((won / decided) * 100) : null,
        decided,
      }}
    />
  );
}
