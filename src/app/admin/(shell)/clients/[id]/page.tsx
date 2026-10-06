import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import CommentThread from "@/components/admin/comments/CommentThread";
import { Icon } from "@/components/admin/icons";
import { Avatar, Badge, PageHead, Panel, Stat } from "@/components/admin/ui";
import { getSession, requireModule } from "@/lib/admin/auth";
import { formatDate, formatDateShort, formatTime, money, toDateInput, todayISO } from "@/lib/admin/format";
import { NEW, hrefFor } from "@/lib/admin/links";
import { canAccess } from "@/lib/admin/modules";
import { displayName, loadTeam } from "@/lib/admin/team";
import { EVENT_KIND_LABEL, type EventKind, type StageTone } from "@/lib/admin/types";
import { rowsOrEmpty, selectTolerant } from "../data";
import { LinkButton } from "../kit";
import {
  BILLED_STATUSES,
  CLIENT_COLUMNS,
  CLIENT_STATUS,
  DOCUMENT_COLUMNS,
  OPEN_STATUSES,
  clientTitle,
  documentBadge,
  formatTotals,
  sumByCurrency,
  type Client,
  type ClientDocument,
} from "../model";
import { ClientActions, ClientNotes } from "./ClientControls";

type Params = { params: Promise<{ id: string }> };

type ClientLead = {
  id: string;
  name: string;
  company: string | null;
  value: number;
  updated_at: string;
  stage: { name: string; tone: StageTone; is_won: boolean; is_lost: boolean } | null;
};

type UpcomingEvent = { id: string; title: string; starts_at: string; all_day: boolean; kind: EventKind };

type OpenTodo = { id: string; title: string; due_at: string | null; all_day: boolean; priority: string };

const STAGE_DOT: Record<StageTone, string> = {
  terra: "bg-terra",
  cream: "bg-cream/60",
  success: "bg-emerald-300",
  warn: "bg-amber-300",
  muted: "bg-sand/60",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A Stat sub-line from optional parts (other currencies, counts). */
const subLine = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ");

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  // The page does the access check; this only names the tab (getSession is cached per request).
  const { id } = await params;
  const session = await getSession();
  if (!session?.profile) return { title: "Client" };
  const { data } = await session.supabase
    .from("clients")
    .select("name, company")
    .eq("id", id)
    .maybeSingle<Pick<Client, "name" | "company">>();
  return { title: data ? clientTitle(data) : "Client" };
}

export default async function ClientPage({ params }: Params) {
  const { supabase, profile } = await requireModule("clients");
  const { id } = await params;
  const can = (key: Parameters<typeof canAccess>[1]) => canAccess(profile, key);

  const found = await selectTolerant<Client>(
    (columns) => supabase.from("clients").select(columns).eq("id", id).limit(1).returns<Client[]>(),
    CLIENT_COLUMNS,
    "account_manager_id",
  );
  const client = found.rows[0];
  if (!client) notFound();

  // All-day events sit at local midnight, so "upcoming" starts at the top of today.
  const startOfToday = `${todayISO()}T00:00:00+05:30`;

  // Each side panel only queries a module the viewer can open, and reads as
  // empty if that module's migration hasn't run yet.
  const [documents, leads, events, todos, team] = await Promise.all([
    can("invoices")
      ? rowsOrEmpty(
          supabase
            .from("invoices")
            .select(DOCUMENT_COLUMNS)
            .eq("client_id", id)
            .order("issue_date", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(200)
            .returns<ClientDocument[]>(),
        )
      : Promise.resolve([] as ClientDocument[]),
    can("crm")
      ? rowsOrEmpty(
          supabase
            .from("leads")
            .select("id, name, company, value, updated_at, stage:pipeline_stages(name, tone, is_won, is_lost)")
            .eq("client_id", id)
            .order("updated_at", { ascending: false })
            .limit(20)
            .returns<ClientLead[]>(),
        )
      : Promise.resolve([] as ClientLead[]),
    can("calendar")
      ? rowsOrEmpty(
          supabase
            .from("calendar_events")
            .select("id, title, starts_at, all_day, kind")
            .eq("client_id", id)
            .eq("done", false)
            .gte("starts_at", startOfToday)
            .order("starts_at", { ascending: true })
            .limit(6)
            .returns<UpcomingEvent[]>(),
        )
      : Promise.resolve([] as UpcomingEvent[]),
    can("todos")
      ? rowsOrEmpty(
          supabase
            .from("todos")
            .select("id, title, due_at, all_day, priority")
            .eq("client_id", id)
            .neq("status", "done")
            .order("due_at", { ascending: true, nullsFirst: false })
            .limit(6)
            .returns<OpenTodo[]>(),
        )
      : Promise.resolve([] as OpenTodo[]),
    loadTeam(supabase),
  ]);

  const managers = team.filter((m) => canAccess({ ...m, workspace: profile.workspace }, "clients"));
  const manager = client.account_manager_id ? team.find((m) => m.id === client.account_manager_id) : undefined;
  const today = todayISO();
  const now = new Date();

  /* ── money (Invoices access only) ── */
  const invoices = documents.filter((d) => d.kind === "invoice");
  const billed = invoices.filter((d) => BILLED_STATUSES.includes(d.status));
  const open = invoices.filter((d) => OPEN_STATUSES.includes(d.status));
  const isOverdue = (d: ClientDocument) => OPEN_STATUSES.includes(d.status) && !!d.due_date && d.due_date < today;
  const overdue = open.filter(isOverdue);
  const openQuotes = documents.filter((d) => d.kind === "quote" && (d.status === "sent" || d.status === "accepted"));

  const byCurrency = (rows: ClientDocument[], value: (d: ClientDocument) => number) =>
    formatTotals(sumByCurrency(rows, (d) => d.currency, value));
  const billedT = byCurrency(billed, (d) => Number(d.total));
  const receivedT = byCurrency(billed, (d) => Number(d.amount_paid));
  const outstandingT = byCurrency(open, (d) => Number(d.balance_due));
  const quotedT = byCurrency(openQuotes, (d) => Number(d.total));
  const owing = open.some((d) => Number(d.balance_due) > 0);

  /* ── details ── */
  const website = client.website
    ? /^https?:\/\//i.test(client.website)
      ? client.website
      : `https://${client.website}`
    : null;
  const details: [string, ReactNode][] = (
    [
      ["Contact", client.name],
      [
        "Email",
        client.email && (
          <a href={`mailto:${client.email}`} className="break-all text-cream hover:text-terra-bright">
            {client.email}
          </a>
        ),
      ],
      [
        "Phone",
        client.phone && (
          <a href={`tel:${client.phone.replace(/[^\d+]/g, "")}`} className="text-cream hover:text-terra-bright">
            {client.phone}
          </a>
        ),
      ],
      ["Address", [client.address, client.city, client.country].filter(Boolean).join(", ")],
      ["Tax / VAT", client.tax_id],
      [
        "Website",
        website && (
          <a href={website} target="_blank" rel="noopener noreferrer" className="break-all text-cream hover:text-terra-bright">
            {client.website}
          </a>
        ),
      ],
      [
        "Account manager",
        found.full &&
          (manager ? (
            <span className="flex items-center gap-2">
              <Avatar name={displayName(manager)} size={20} />
              {displayName(manager)}
            </span>
          ) : (
            "Unassigned"
          )),
      ],
      ["Client since", formatDate(client.created_at)],
    ] as [string, ReactNode][]
  ).filter(([, value]) => !!value);

  const showUpcoming = can("calendar") || can("todos");

  return (
    <>
      <PageHead
        eyebrow={`Client · ${CLIENT_STATUS[client.status]?.label ?? client.status}`}
        title={clientTitle(client)}
        hint={client.company ? client.name : undefined}
        actions={
          <ClientActions
            client={client}
            managers={managers}
            me={profile.id}
            ownership={found.full}
            managerName={manager ? displayName(manager) : undefined}
          />
        }
      />

      {/* Money is only shown to people who can open Invoices. */}
      {can("invoices") && (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Billed"
            value={billedT.main}
            sub={subLine(billedT.rest, plural(billed.length, "invoice") + " issued")}
            icon={<Icon.receipt size={15} />}
          />
          <Stat
            label="Received"
            value={receivedT.main}
            sub={subLine(receivedT.rest, "Payments recorded")}
            tone="success"
            icon={<Icon.down size={15} />}
          />
          <Stat
            label="Outstanding"
            value={outstandingT.main}
            sub={subLine(outstandingT.rest, overdue.length ? `${overdue.length} overdue` : owing ? "Nothing overdue" : "All settled")}
            tone={overdue.length ? "danger" : owing ? "terra" : "neutral"}
            icon={<Icon.clock size={15} />}
          />
          <Stat
            label="Open quotes"
            value={openQuotes.length}
            sub={openQuotes.length ? subLine(`${quotedT.main} quoted`, quotedT.rest) : "None waiting on them"}
            icon={<Icon.note size={15} />}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Side column — first on phones so contact details sit up top. */}
        <aside className="min-w-0 space-y-4 xl:col-start-2 xl:row-start-1">
          <Panel title="Details">
            <dl className="space-y-2.5">
              {details.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
                  <dt className="pt-0.5 text-[10px] uppercase tracking-[0.16em] text-sand">{label}</dt>
                  <dd className="min-w-0 break-words text-[12.5px] text-cream-2">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          {showUpcoming && (
            <Panel title="Coming up" hint="Events and open to-dos linked to this client" bodyClass="p-0">
              {events.length === 0 && todos.length === 0 ? (
                <p className="px-4 py-6 text-center text-[12px] text-sand">Nothing scheduled.</p>
              ) : (
                <ul>
                  {events.map((e) => (
                    <li key={`event:${e.id}`} className="border-b border-cream/[0.05] last:border-0">
                      <Link
                        href={hrefFor("event", e.id) ?? "/admin/calendar"}
                        className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-cream/[0.03]"
                      >
                        <span className="mt-0.5 shrink-0 text-sand/70">
                          <Icon.calendar size={13} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-cream">{e.title}</span>
                          <span className="block font-mono text-[10.5px] uppercase tracking-[0.06em] text-sand">
                            {EVENT_KIND_LABEL[e.kind] ?? e.kind} · {formatDateShort(e.starts_at)}
                            {e.all_day ? "" : ` · ${formatTime(e.starts_at)}`}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                  {todos.map((t) => {
                    // All-day to-dos are late from the next day, timed ones from the minute.
                    const late =
                      !!t.due_at && (t.all_day ? toDateInput(new Date(t.due_at)) < today : new Date(t.due_at) < now);
                    return (
                      <li key={`todo:${t.id}`} className="border-b border-cream/[0.05] last:border-0">
                        <Link
                          href={hrefFor("todo", t.id) ?? "/admin/todos"}
                          className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-cream/[0.03]"
                        >
                          <span className="mt-0.5 shrink-0 text-sand/70">
                            <Icon.checklist size={13} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] text-cream">{t.title}</span>
                            <span
                              className={`block font-mono text-[10.5px] uppercase tracking-[0.06em] ${late ? "text-rose-300" : "text-sand"}`}
                            >
                              To-do · {t.due_at ? `${late ? "was due" : "due"} ${formatDateShort(t.due_at)}` : "no date"}
                              {t.priority === "high" || t.priority === "urgent" ? ` · ${t.priority}` : ""}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          )}

          <Panel title="Notes" hint="Shared with everyone who can open Clients">
            <ClientNotes id={client.id} notes={client.notes} />
          </Panel>
        </aside>

        <div className="min-w-0 space-y-4 xl:col-start-1 xl:row-start-1">
          {can("invoices") && (
            <Panel
              title="Invoices & quotes"
              hint={documents.length ? plural(documents.length, "document") : undefined}
              bodyClass="p-0"
              right={
                <>
                  <LinkButton href={NEW.quote({ client: client.id })}>
                    <Icon.plus size={13} /> Quote
                  </LinkButton>
                  <LinkButton href={NEW.invoice({ client: client.id })}>
                    <Icon.plus size={13} /> Invoice
                  </LinkButton>
                </>
              }
            >
              {documents.length === 0 ? (
                <p className="px-4 py-6 text-center text-[12px] text-sand">No invoices or quotes yet.</p>
              ) : (
                <ul>
                  {documents.map((d) => {
                    const late = isOverdue(d);
                    const badge = documentBadge(d, late);
                    const balance = Number(d.balance_due);
                    return (
                      <li key={d.id} className="border-b border-cream/[0.05] last:border-0">
                        <Link
                          href={hrefFor(d.kind, d.id) ?? "/admin/invoices"}
                          className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-cream/[0.03]"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-cream">
                              <span className="font-mono">
                                {d.number ?? (d.kind === "quote" ? "Draft quote" : "Draft invoice")}
                              </span>
                              {d.subject && <span className="text-sand"> · {d.subject}</span>}
                            </span>
                            <span className={`block font-mono text-[10.5px] ${late ? "text-rose-300" : "text-sand"}`}>
                              {d.kind === "quote" ? "Quote" : "Invoice"} · {formatDateShort(d.issue_date)}
                              {d.kind === "invoice" && d.due_date ? ` · due ${formatDateShort(d.due_date)}` : ""}
                              {OPEN_STATUSES.includes(d.status) && balance > 0
                                ? ` · ${money(balance, { code: d.currency })} left`
                                : ""}
                            </span>
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-1.5">
                            <span className="font-mono text-[12.5px] text-cream tabular-nums">
                              {money(Number(d.total), { code: d.currency })}
                            </span>
                            <Badge tone={badge.tone}>{badge.label}</Badge>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          )}

          {can("crm") && (
            <Panel title="Leads" hint="Deals in the CRM linked to this client" bodyClass="p-0">
              {leads.length === 0 ? (
                <p className="px-4 py-6 text-center text-[12px] text-sand">
                  No deals linked. Link one from its card in the CRM.
                </p>
              ) : (
                <ul>
                  {leads.map((l) => (
                    <li key={l.id} className="border-b border-cream/[0.05] last:border-0">
                      <Link
                        href={hrefFor("lead", l.id) ?? "/admin/crm"}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-cream/[0.03]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-cream">{l.company || l.name}</span>
                          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-sand">
                            {l.stage && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STAGE_DOT[l.stage.tone] ?? STAGE_DOT.cream}`} />}
                            <span className="truncate">{l.stage?.name ?? "No stage"}</span>
                          </span>
                        </span>
                        <span className="shrink-0 font-mono text-[12px] text-cream-2 tabular-nums">{money(Number(l.value))}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          <Panel title="Discussion" hint="Mention a teammate with @ to bring them in">
            {/* Mentions are limited to people who can open Clients. */}
            <CommentThread target={{ type: "client", id: client.id }} people={managers} />
          </Panel>
        </div>
      </div>
    </>
  );
}
