"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/admin/icons";
import { Tabs } from "@/components/admin/Tabs";
import { useAction } from "@/components/admin/useAction";
import { Button, Input, Panel, Stat } from "@/components/admin/ui";
import { DownloadPdfButton, EmailDocumentButton } from "@/components/admin/invoice/DocumentMail";
import { formatDate } from "@/lib/admin/format";
import { docMoney } from "@/lib/admin/invoice-types";
import { LINE_LABEL, STATEMENT_PRESETS, type Statement, type StatementPreset } from "@/lib/admin/statement";
import { emailStatement, statementEmailDraft, statementPdf } from "@/app/admin/actions/documents";

export default function StatementScreen({ statement: st, preset }: { statement: Statement; preset: StatementPreset }) {
  const router = useRouter();
  const { run, pending, toast } = useAction();
  const [range, setRange] = useState({ from: st.from, to: st.to });
  const money = (v: number) => docMoney(v, st.currency);
  const args = { clientId: st.client.id, from: st.from, to: st.to, currency: st.currency };
  const go = (params: Record<string, string>) =>
    router.push(`/admin/invoices/statement/${st.client.id}?${new URLSearchParams({ ...params, currency: st.currency })}`);
  const overdue = st.open.filter((o) => o.days_overdue > 0).reduce((a, o) => a + o.balance, 0);

  return (
    <>
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            size="xs"
            value={preset}
            onChange={(p) => (p === "custom" ? go({ period: "custom", ...range }) : go({ period: p }))}
            options={STATEMENT_PRESETS}
          />
          {preset === "custom" && (
            <span className="flex flex-wrap items-center gap-1.5">
              <Input type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
              <Input type="date" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
              <Button onClick={() => go({ period: "custom", ...range })} className="min-h-9">
                Show
              </Button>
            </span>
          )}
          {st.currencies.length > 1 && (
            <select
              value={st.currency}
              onChange={(e) =>
                router.push(`/admin/invoices/statement/${st.client.id}?${new URLSearchParams({ period: preset, from: st.from, to: st.to, currency: e.target.value })}`)
              }
              aria-label="Currency"
              className="min-h-9 border border-cream/12 bg-ink/60 px-2.5 text-[12px] text-cream-2"
            >
              {st.currencies.map((c) => (
                <option key={c} value={c} className="bg-ink text-cream">
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <EmailDocumentButton
            label="statement"
            run={run}
            pending={pending}
            loadDraft={() => statementEmailDraft(args)}
            send={(d) => emailStatement(args, { to: d.to, cc: d.cc, subject: d.subject, message: d.message })}
          />
          <DownloadPdfButton run={run} pending={pending} load={() => statementPdf(args)} />
          <Button variant="quiet" onClick={() => window.print()} className="min-h-9">
            <Icon.printer size={13} /> Print
          </Button>
        </div>
      </div>

      <div className="mt-1">
        <h2 className="font-display text-[22px] font-medium text-cream">
          Statement · {st.client.company || st.client.name}
        </h2>
        <p className="mt-1 text-[12px] text-sand">
          {formatDate(st.from)} – {formatDate(st.to)} · {st.currency}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Brought forward" value={money(st.opening)} sub={`On ${formatDate(st.from)}`} />
        <Stat label="Invoiced" value={money(st.period_debit)} sub="Invoices and refunds in the period" />
        <Stat label="Paid & credited" value={money(st.period_credit)} sub="Payments and credit notes" tone="success" />
        <Stat
          label="Balance"
          value={money(st.closing)}
          sub={overdue > 0 ? `${money(overdue)} overdue` : st.closing > 0 ? "Nothing overdue" : "Nothing owed"}
          tone={overdue > 0 ? "danger" : st.closing > 0 ? "terra" : "neutral"}
        />
      </div>

      <Panel title="Movements" bodyClass="p-0">
        <div className="overflow-x-auto scroll-thin" data-lenis-prevent>
          <table className="w-full min-w-[680px] border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-cream/[0.08] text-[10px] uppercase tracking-[0.16em] text-sand">
                <th className="px-3 py-2.5 font-normal">Date</th>
                <th className="px-3 py-2.5 font-normal">Details</th>
                <th className="px-3 py-2.5 text-right font-normal">Charges</th>
                <th className="px-3 py-2.5 text-right font-normal">Credits</th>
                <th className="px-3 py-2.5 text-right font-normal">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-cream/[0.05]">
                <td className="whitespace-nowrap px-3 py-2 text-sand">{formatDate(st.from)}</td>
                <td className="px-3 py-2 text-cream-2">Balance brought forward</td>
                <td />
                <td />
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-cream">{money(st.opening)}</td>
              </tr>
              {st.lines.map((l, i) => (
                <tr key={i} className="border-b border-cream/[0.05]">
                  <td className="whitespace-nowrap px-3 py-2 text-sand">{formatDate(l.date)}</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/invoices/${l.doc_id}`} className="text-cream-2 hover:text-terra-bright">
                      {LINE_LABEL[l.type]} <span className="font-mono">{l.ref ?? ""}</span>
                    </Link>
                    {l.detail && !["Invoice"].includes(l.detail) && <span className="ml-1.5 text-[11px] text-sand">{l.detail}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-cream-2">{l.debit ? money(l.debit) : ""}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-ok-300">{l.credit ? money(l.credit) : ""}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-cream">{money(l.balance)}</td>
                </tr>
              ))}
              <tr>
                <td />
                <td className="px-3 py-2.5 font-display text-[13px] text-cream">Balance carried forward</td>
                <td />
                <td />
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-terra-bright">{money(st.closing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      {st.open.length > 0 && (
        <Panel title="Open invoices" hint="Still owed, with how late each is at the end of the period." bodyClass="p-0">
          <ul>
            {st.open.map((o) => (
              <li key={o.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-cream/[0.05] px-4 py-2.5 last:border-0">
                <Link href={`/admin/invoices/${o.id}`} className="font-mono text-[12px] text-cream-2 hover:text-terra-bright">
                  {o.number ?? "—"}
                </Link>
                <span className={`text-[11.5px] ${o.days_overdue > 0 ? "text-bad-300" : "text-sand"}`}>
                  {o.due_date ? `Due ${formatDate(o.due_date)}` : "Due on receipt"}
                  {o.days_overdue > 0 ? ` · ${o.days_overdue} days overdue` : ""}
                </span>
                <span className="font-mono text-[12px] tabular-nums text-cream">{money(o.balance)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {toast}
    </>
  );
}
