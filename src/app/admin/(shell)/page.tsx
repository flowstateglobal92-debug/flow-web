import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin/auth";
import type { CalendarEvent, FinanceTotals, Inquiry, Lead, Stage } from "@/lib/admin/types";
import { Avatar, Badge, EmptyState, Panel, PageHead, Stat } from "@/components/admin/ui";
import { Icon } from "@/components/admin/icons";
import { money, moneyShort, relativeTime } from "@/lib/admin/format";
import Calendar from "./Calendar";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { supabase, profile } = await requireAdmin();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const windowEnd = new Date(now.getFullYear(), now.getMonth() + 7, 1);

  const [
    { count: newInquiries },
    { data: latestInquiries },
    { data: stages },
    { data: leads },
    { data: totals },
    { data: monthEntries },
    { data: events },
  ] = await Promise.all([
    supabase.from("inquiries").select("id", { count: "exact", head: true }).eq("status", "new"),
    supabase
      .from("inquiries")
      .select("id, name, business, contact, focus, message, source, page, status, converted_lead_id, notes, created_at")
      .order("created_at", { ascending: false })
      .limit(5)
      .returns<Inquiry[]>(),
    supabase
      .from("pipeline_stages")
      .select("id, name, slug, position, tone, is_protected, is_won, is_lost")
      .order("position", { ascending: true })
      .returns<Stage[]>(),
    supabase
      .from("leads")
      .select("id, stage_id, name, company, value, score, updated_at, created_at")
      .returns<Pick<Lead, "id" | "stage_id" | "name" | "company" | "value" | "score" | "updated_at" | "created_at">[]>(),
    supabase.from("finance_totals").select("income, expense, profit, entries").maybeSingle<FinanceTotals>(),
    supabase
      .from("finance_entries")
      .select("kind, amount")
      .gte("entry_date", monthStart.toISOString().slice(0, 10))
      .returns<{ kind: string; amount: number }[]>(),
    supabase
      .from("calendar_events")
      .select("id, title, description, starts_at, ends_at, all_day, kind, done, lead_id, inquiry_id")
      .gte("starts_at", windowStart.toISOString())
      .lt("starts_at", windowEnd.toISOString())
      .order("starts_at", { ascending: true })
      .returns<CalendarEvent[]>(),
  ]);

  const stageList = stages ?? [];
  const leadList = leads ?? [];
  const openStageIds = stageList.filter((s) => !s.is_won && !s.is_lost).map((s) => s.id);
  const wonStageIds = stageList.filter((s) => s.is_won).map((s) => s.id);

  const openValue = leadList
    .filter((l) => openStageIds.includes(l.stage_id))
    .reduce((a, l) => a + Number(l.value), 0);
  const wonValue = leadList.filter((l) => wonStageIds.includes(l.stage_id)).reduce((a, l) => a + Number(l.value), 0);

  const profit = Number(totals?.profit ?? 0);
  const monthIncome = (monthEntries ?? [])
    .filter((e) => e.kind === "income")
    .reduce((a, e) => a + Number(e.amount), 0);
  const monthExpense = (monthEntries ?? [])
    .filter((e) => e.kind === "expense")
    .reduce((a, e) => a + Number(e.amount), 0);
  const monthProfit = monthIncome - monthExpense;

  const upcoming = (events ?? [])
    .filter((e) => !e.done && new Date(e.starts_at).getTime() >= now.getTime() - 3_600_000)
    .slice(0, 5);

  const firstName = (profile.full_name ?? profile.email).split(/[\s@]/)[0];

  return (
    <>
      <PageHead
        eyebrow={new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(now)}
        title={`Good to see you, ${firstName.charAt(0).toUpperCase() + firstName.slice(1)}`}
        hint="Everything the business is carrying right now — inbound, pipeline, books and what's coming up."
      />

      {/* Top strip — one number from each area */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="New inquiries"
          value={newInquiries ?? 0}
          sub={newInquiries ? "Waiting on a first reply" : "Inbox is clear"}
          tone={newInquiries ? "terra" : "neutral"}
          icon={<Icon.inbox size={15} />}
        />
        <Stat
          label="Open pipeline"
          value={moneyShort(openValue)}
          sub={`${leadList.filter((l) => openStageIds.includes(l.stage_id)).length} live leads`}
          icon={<Icon.pipeline size={15} />}
        />
        <Stat
          label="Won"
          value={moneyShort(wonValue)}
          sub={`${leadList.filter((l) => wonStageIds.includes(l.stage_id)).length} closed deals`}
          tone="success"
          icon={<Icon.check size={15} />}
        />
        <Stat
          label={profit < 0 ? "Net loss" : "Net profit"}
          value={money(profit)}
          sub={`${monthProfit < 0 ? "−" : "+"}${moneyShort(Math.abs(monthProfit)).replace("−", "")} this month`}
          tone={profit < 0 ? "danger" : "success"}
          icon={<Icon.ledger size={15} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        <Calendar events={events ?? []} leads={leadList.map((l) => ({ id: l.id, label: l.company || l.name }))} />

        <div className="flex flex-col gap-4">
          <Panel
            title="Coming up"
            hint="Next on the calendar"
            bodyClass="p-0"
            right={
              <Badge tone="terra">
                <Icon.calendar size={11} /> {upcoming.length}
              </Badge>
            }
          >
            {upcoming.length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-sand">Nothing scheduled. Add something on the calendar.</p>
            ) : (
              <ul>
                {upcoming.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 border-b border-cream/[0.05] px-4 py-3 last:border-0">
                    <span className="mt-0.5 shrink-0 text-terra-bright">
                      <Icon.calendar size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-cream">{e.title}</span>
                      <span className="block text-[10.5px] text-sand">
                        {new Intl.DateTimeFormat("en-GB", {
                          weekday: "short",
                          day: "2-digit",
                          month: "short",
                          ...(e.all_day ? {} : { hour: "2-digit", minute: "2-digit", hour12: false }),
                        }).format(new Date(e.starts_at))}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Latest inquiries"
            hint="Straight from the website form"
            bodyClass="p-0"
            right={
              <Link href="/admin/inquiries" className="text-[11.5px] text-sand transition-colors hover:text-cream">
                View all
              </Link>
            }
          >
            {(latestInquiries ?? []).length === 0 ? (
              <div className="p-4">
                <EmptyState title="No inquiries yet" hint="Submissions from the walkthrough form appear here." />
              </div>
            ) : (
              <ul>
                {(latestInquiries ?? []).map((i) => (
                  <li key={i.id}>
                    <Link
                      href="/admin/inquiries"
                      className="flex items-center gap-2.5 border-b border-cream/[0.05] px-4 py-3 transition-colors last:border-0 hover:bg-cream/[0.04]"
                    >
                      <Avatar name={i.name} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-cream">{i.name}</span>
                        <span className="block truncate text-[10.5px] text-sand">{i.business ?? i.contact}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[10.5px] text-sand">{relativeTime(i.created_at)}</span>
                        {i.status === "new" && (
                          <span className="mt-0.5 block font-mono text-[9.5px] uppercase tracking-[0.1em] text-terra-bright">
                            new
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Pipeline"
            hint="Where the value is sitting"
            bodyClass="p-0"
            right={
              <Link href="/admin/crm" className="text-[11.5px] text-sand transition-colors hover:text-cream">
                Open board
              </Link>
            }
          >
            {stageList.length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-sand">Run migration 0003 to create the pipeline.</p>
            ) : (
              <ul>
                {stageList.map((s) => {
                  const inStage = leadList.filter((l) => l.stage_id === s.id);
                  const value = inStage.reduce((a, l) => a + Number(l.value), 0);
                  const share = openValue + wonValue > 0 ? (value / (openValue + wonValue)) * 100 : 0;
                  return (
                    <li key={s.id} className="border-b border-cream/[0.05] px-4 py-2.5 last:border-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[12px] text-cream-2">{s.name}</span>
                        <span className="shrink-0 font-mono text-[11px] text-sand tabular-nums">
                          {inStage.length} · {moneyShort(value)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 w-full bg-cream/[0.06]">
                        <div
                          className={`h-full ${s.is_won ? "bg-emerald-400/70" : s.is_lost ? "bg-sand/40" : "bg-terra"}`}
                          style={{ width: `${Math.max(share, value > 0 ? 4 : 0)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
