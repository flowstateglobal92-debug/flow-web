"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Modal from "@/components/admin/Modal";
import { Icon } from "@/components/admin/icons";
import { Tabs } from "@/components/admin/Tabs";
import { useAction } from "@/components/admin/useAction";
import { Badge, Button, EmptyState, Field, Input, Notice, Panel, Select, Stat } from "@/components/admin/ui";
import { formatDate, money, moneyShort } from "@/lib/admin/format";
import { docMoney } from "@/lib/admin/invoice-types";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/admin/types";
import {
  bankRows,
  fingerprints,
  guessBankColumns,
  guessDateFormat,
  parseCSV,
  type BankColumns,
  type DateFormat,
} from "@/lib/admin/csv";
import {
  bankLineSuggestions,
  entryFromLine,
  ignoreBankLine,
  importBankLines,
  matchBankLine,
  payBillFromLine,
  payInvoiceFromLine,
  saveBankAccount,
  unmatchBankLine,
  type Suggestions,
} from "@/app/admin/actions/bank";

export type BankAccount = { id: string; name: string; currency: string; last4: string | null; active: boolean };
export type BankLine = {
  id: string;
  account_id: string;
  posted_on: string;
  description: string;
  reference: string | null;
  amount: number;
  balance: number | null;
  status: "unmatched" | "matched" | "ignored";
  matched_entry_id: string | null;
  note: string | null;
  entry?: { description: string; category: string } | null;
};

type Run = ReturnType<typeof useAction>["run"];
type Filter = "unmatched" | "matched" | "ignored" | "all";

export default function BankScreen({
  ready,
  accounts,
  account,
  lines,
  canInvoices,
}: {
  ready: boolean;
  accounts: BankAccount[];
  account: BankAccount | null;
  lines: BankLine[];
  canInvoices: boolean;
}) {
  const router = useRouter();
  const { run, pending, toast } = useAction();
  const [filter, setFilter] = useState<Filter>("unmatched");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [matching, setMatching] = useState<BankLine | null>(null);

  const counts = {
    unmatched: lines.filter((l) => l.status === "unmatched").length,
    matched: lines.filter((l) => l.status === "matched").length,
    ignored: lines.filter((l) => l.status === "ignored").length,
  };
  const shown = useMemo(() => (filter === "all" ? lines : lines.filter((l) => l.status === filter)), [lines, filter]);
  const unmatchedIn = lines.filter((l) => l.status === "unmatched" && l.amount > 0).reduce((a, l) => a + Number(l.amount), 0);
  const unmatchedOut = lines.filter((l) => l.status === "unmatched" && l.amount < 0).reduce((a, l) => a + Number(l.amount), 0);
  const latest = lines.find((l) => l.balance != null);

  if (!ready) {
    return (
      <Notice tone="warn" title="Bank statements aren't set up yet">
        They arrive with the bank statements migration (0041).
      </Notice>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {accounts.length > 0 && (
            <Select
              value={account?.id ?? ""}
              onChange={(e) => router.push(`/admin/expenses/bank?account=${e.target.value}`)}
              aria-label="Account"
              className="min-w-[220px]"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id} className="bg-ink text-cream">
                  {a.name}
                  {a.last4 ? ` · ${a.last4}` : ""}
                </option>
              ))}
            </Select>
          )}
          <Button onClick={() => setAdding(true)} className="min-h-9">
            <Icon.plus size={13} /> Account
          </Button>
        </div>
        {account && (
          <Button variant="primary" onClick={() => setImporting(true)} className="min-h-9">
            <Icon.upload size={13} /> Import statement
          </Button>
        )}
      </div>

      {!account ? (
        <Panel>
          <EmptyState
            title="Add your bank account"
            hint="Then import its statement as CSV (every Sri Lankan bank's online banking exports one) and tie each line to the books."
            action={
              <Button variant="primary" onClick={() => setAdding(true)} className="min-h-9">
                <Icon.plus size={13} /> Add account
              </Button>
            }
          />
        </Panel>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="To match" value={counts.unmatched} sub={`${counts.matched} matched · ${counts.ignored} set aside`} tone={counts.unmatched ? "terra" : "success"} icon={<Icon.link size={15} />} />
            <Stat label="Unmatched in" value={moneyShort(unmatchedIn)} sub="Money in not in the books yet" tone="success" icon={<Icon.down size={15} />} />
            <Stat label="Unmatched out" value={moneyShort(Math.abs(unmatchedOut))} sub="Money out not in the books yet" tone="danger" icon={<Icon.up size={15} />} />
            <Stat label="Bank balance" value={latest ? money(Number(latest.balance)) : "—"} sub={latest ? `As of ${formatDate(latest.posted_on)}` : "From the statement, when it has one"} icon={<Icon.ledger size={15} />} />
          </div>

          <Tabs
            className="mb-4"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "unmatched", label: "To match", count: counts.unmatched },
              { value: "matched", label: "Matched", count: counts.matched },
              { value: "ignored", label: "Set aside", count: counts.ignored },
              { value: "all", label: "All" },
            ]}
          />

          <Panel bodyClass="p-0">
            {shown.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title={lines.length === 0 ? "No statement lines yet" : "Nothing here"}
                  hint={lines.length === 0 ? "Import a CSV from your online banking." : filter === "unmatched" ? "Every line is matched — nice." : "Try another tab."}
                />
              </div>
            ) : (
              <ul>
                {shown.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-cream/[0.05] px-4 py-3 last:border-0">
                    <span className="w-24 shrink-0 text-[11.5px] text-sand">{formatDate(l.posted_on)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-cream">{l.description || "—"}</span>
                      <span className="block truncate text-[11px] text-sand">
                        {l.status === "matched" && l.entry
                          ? `Matched · ${l.entry.description} · ${l.entry.category}`
                          : l.status === "ignored"
                            ? `Set aside${l.note ? ` · ${l.note}` : ""}`
                            : l.reference ?? ""}
                      </span>
                    </span>
                    <span className={`font-mono text-[12.5px] tabular-nums ${l.amount > 0 ? "text-ok-300" : "text-cream"}`}>
                      {l.amount > 0 ? "+" : "−"}
                      {docMoney(Math.abs(Number(l.amount)), account.currency)}
                    </span>
                    {l.status === "unmatched" ? (
                      <Button onClick={() => setMatching(l)} className="min-h-9">
                        Match…
                      </Button>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Badge tone={l.status === "matched" ? "success" : "muted"}>{l.status === "matched" ? "Matched" : "Aside"}</Badge>
                        <Button variant="quiet" disabled={pending} onClick={() => run(() => unmatchBankLine(l.id))} className="min-h-9">
                          Undo
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}

      {adding && <AccountModal onClose={() => setAdding(false)} run={run} pending={pending} />}
      {importing && account && <ImportModal account={account} onClose={() => setImporting(false)} run={run} pending={pending} />}
      {matching && account && (
        <MatchModal line={matching} currency={account.currency} canInvoices={canInvoices} onClose={() => setMatching(null)} run={run} pending={pending} />
      )}
      {toast}
    </>
  );
}

function AccountModal({ onClose, run, pending }: { onClose: () => void; run: Run; pending: boolean }) {
  const [v, setV] = useState({ name: "", currency: "LKR", last4: "" });
  return (
    <Modal open onClose={onClose} title="Add a bank account">
      <div className="space-y-3">
        <Field label="Name">
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Commercial Bank · current" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Currency">
            <Input value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })} maxLength={3} />
          </Field>
          <Field label="Last digits" hint="Optional.">
            <Input value={v.last4} onChange={(e) => setV({ ...v, last4: e.target.value })} maxLength={6} />
          </Field>
        </div>
      </div>
      <div className="mt-4 flex justify-end border-t border-cream/[0.08] pt-3">
        <Button variant="primary" disabled={pending || !v.name.trim()} onClick={() => run(() => saveBankAccount(null, v), { onDone: (r) => r.ok && onClose() })} className="min-h-9">
          Add account
        </Button>
      </div>
    </Modal>
  );
}

const COLS: { key: keyof BankColumns; label: string; optional: boolean }[] = [
  { key: "date", label: "Date", optional: false },
  { key: "description", label: "Description", optional: false },
  { key: "reference", label: "Reference", optional: true },
  { key: "amount", label: "Amount (+ in, − out)", optional: true },
  { key: "debit", label: "Money out (debit)", optional: true },
  { key: "credit", label: "Money in (credit)", optional: true },
  { key: "balance", label: "Balance", optional: true },
];

function ImportModal({ account, onClose, run, pending }: { account: BankAccount; onClose: () => void; run: Run; pending: boolean }) {
  const [table, setTable] = useState<string[][] | null>(null);
  const [header, setHeader] = useState(true);
  const [cols, setCols] = useState<BankColumns | null>(null);
  const [format, setFormat] = useState<DateFormat>("dmy");
  const [problem, setProblem] = useState<string | null>(null);

  const load = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    if (file.size > 10 * 1024 * 1024) return setProblem("That file is over 10 MB — export a shorter period.");
    const rows = parseCSV(await file.text());
    if (rows.length < 2) return setProblem("That file has no rows to import.");
    setTable(rows);
    const guess = guessBankColumns(rows[0]);
    setCols(guess);
    setFormat(guessDateFormat(rows.slice(1, 50).map((r) => r[guess.date] ?? "")));
  };

  const body = table ? (header ? table.slice(1) : table) : [];
  const parsed = cols ? bankRows(body, cols, format) : { rows: [], skipped: 0 };
  const width = table ? Math.max(...table.slice(0, 5).map((r) => r.length)) : 0;
  const names = table ? Array.from({ length: width }, (_, i) => (header ? table[0][i] : "") || `Column ${i + 1}`) : [];

  return (
    <Modal open onClose={onClose} title={`Import a statement · ${account.name}`} hint="A CSV from your online banking. Lines already here are skipped." width="max-w-3xl">
      {!table ? (
        <div className="space-y-3">
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 border border-dashed border-cream/20 text-[12.5px] text-sand hover:border-cream/40 hover:text-cream">
            <Icon.upload size={18} />
            Choose the CSV file
            <input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => void load(e.target.files?.[0])} />
          </label>
          {problem && <p className="text-[12px] text-bad-300">{problem}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-[12.5px] text-cream-2">
            <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} className="h-4 w-4 accent-terra" /> The first row is headings
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            {COLS.map((c) => (
              <Field key={c.key} label={c.label}>
                <Select
                  value={cols?.[c.key] == null ? "" : String(cols[c.key])}
                  onChange={(e) => setCols((x) => (x ? { ...x, [c.key]: e.target.value === "" ? null : Number(e.target.value) } : x))}
                >
                  {c.optional && (
                    <option value="" className="bg-ink text-cream">
                      —
                    </option>
                  )}
                  {names.map((n, i) => (
                    <option key={i} value={i} className="bg-ink text-cream">
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
            <Field label="Dates are">
              <Select value={format} onChange={(e) => setFormat(e.target.value as DateFormat)}>
                <option value="dmy" className="bg-ink text-cream">
                  Day / month / year
                </option>
                <option value="mdy" className="bg-ink text-cream">
                  Month / day / year
                </option>
                <option value="ymd" className="bg-ink text-cream">
                  Year-month-day
                </option>
              </Select>
            </Field>
          </div>
          <div className="border border-cream/[0.08]">
            <p className="border-b border-cream/[0.08] px-3 py-2 text-[11.5px] text-sand">
              {parsed.rows.length} transaction{parsed.rows.length === 1 ? "" : "s"}
              {parsed.skipped ? ` · ${parsed.skipped} row${parsed.skipped === 1 ? "" : "s"} that aren't transactions left out` : ""}
            </p>
            <ul className="max-h-60 overflow-y-auto scroll-thin">
              {parsed.rows.slice(0, 12).map((r, i) => (
                <li key={i} className="flex gap-3 border-b border-cream/[0.04] px-3 py-1.5 text-[12px] last:border-0">
                  <span className="w-24 shrink-0 text-sand">{formatDate(r.posted_on)}</span>
                  <span className="min-w-0 flex-1 truncate text-cream-2">{r.description}</span>
                  <span className={`font-mono tabular-nums ${r.amount > 0 ? "text-ok-300" : "text-cream"}`}>
                    {r.amount > 0 ? "+" : "−"}
                    {docMoney(Math.abs(r.amount), account.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-between gap-2 border-t border-cream/[0.08] pt-3">
            <Button onClick={() => setTable(null)} className="min-h-9">
              Another file
            </Button>
            <Button
              variant="primary"
              disabled={pending || parsed.rows.length === 0}
              onClick={() => {
                const prints = fingerprints(parsed.rows);
                run(() => importBankLines(account.id, parsed.rows.map((r, i) => ({ ...r, fingerprint: prints[i] }))), {
                  onDone: (r) => r.ok && onClose(),
                });
              }}
              className="min-h-9"
            >
              Import {parsed.rows.length} line{parsed.rows.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function MatchModal({
  line,
  currency,
  canInvoices,
  onClose,
  run,
  pending,
}: {
  line: BankLine;
  currency: string;
  canInvoices: boolean;
  onClose: () => void;
  run: Run;
  pending: boolean;
}) {
  const incoming = line.amount > 0;
  const [tab, setTab] = useState<"entries" | "documents" | "new" | "aside">("entries");
  const [s, setS] = useState<Suggestions | null>(null);
  const [entry, setEntry] = useState({ category: "", description: line.description });
  const [note, setNote] = useState("");
  const done = { onDone: (r: { ok: boolean }) => r.ok && onClose() };

  useEffect(() => {
    let live = true;
    void bankLineSuggestions(line.id).then((r) => live && setS(r.suggestions ?? { entries: [], invoices: [], bills: [] }));
    return () => {
      live = false;
    };
  }, [line.id]);
  const docs = incoming ? (canInvoices ? (s?.invoices ?? []) : []) : (s?.bills ?? []);

  return (
    <Modal
      open
      onClose={onClose}
      title={`${incoming ? "+" : "−"}${docMoney(Math.abs(Number(line.amount)), currency)} · ${formatDate(line.posted_on)}`}
      hint={line.description}
      width="max-w-xl"
    >
      <Tabs
        size="xs"
        className="mb-3"
        value={tab}
        onChange={setTab}
        options={[
          { value: "entries", label: "In the ledger", count: s?.entries.length },
          { value: "documents", label: incoming ? "Invoice payment" : "Bill payment", count: docs.length },
          { value: "new", label: incoming ? "New income" : "New expense" },
          { value: "aside", label: "Set aside" },
        ]}
      />
      {!s ? (
        <p className="py-6 text-center text-[12px] text-sand">Looking for matches…</p>
      ) : tab === "entries" ? (
        s.entries.length === 0 ? (
          <p className="text-[12px] text-sand">No ledger entry of that amount within three weeks. Record it as a payment or a new entry instead.</p>
        ) : (
          <ul className="space-y-1.5">
            {s.entries.map((e) => (
              <li key={e.id}>
                <button type="button" disabled={pending} onClick={() => run(() => matchBankLine(line.id, e.id), done)} className="flex w-full items-center justify-between gap-3 border border-cream/[0.08] px-3 py-2 text-left hover:border-terra/40">
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] text-cream">{e.description}</span>
                    <span className="block text-[11px] text-sand">
                      {formatDate(e.date)} · {e.category}
                    </span>
                  </span>
                  <span className="font-mono text-[12px] tabular-nums text-cream-2">{money(Math.abs(Number(e.amount)))}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : tab === "documents" ? (
        docs.length === 0 ? (
          <p className="text-[12px] text-sand">
            {incoming && !canInvoices ? "Recording invoice payments needs Invoices access." : `No open ${incoming ? "invoice" : "bill"} could take this amount.`}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {docs.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => (incoming ? payInvoiceFromLine(line.id, d.id) : payBillFromLine(line.id, d.id)), done)}
                  className="flex w-full items-center justify-between gap-3 border border-cream/[0.08] px-3 py-2 text-left hover:border-terra/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] text-cream">
                      {"number" in d ? `${d.number ?? "Invoice"} · ${d.client}` : `${d.supplier}${d.reference ? ` · ${d.reference}` : ""}`}
                    </span>
                    <span className="block text-[11px] text-sand">{d.due_date ? `Due ${formatDate(d.due_date)}` : "No due date"}</span>
                  </span>
                  <span className="font-mono text-[12px] tabular-nums text-cream-2">{docMoney(Number(d.balance), d.currency)} left</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : tab === "new" ? (
        <div className="space-y-3">
          <Field label="Category">
            <Input value={entry.category} onChange={(e) => setEntry({ ...entry, category: e.target.value })} list="bank-categories" />
            <datalist id="bank-categories">
              {(incoming ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Description">
            <Input value={entry.description} onChange={(e) => setEntry({ ...entry, description: e.target.value })} />
          </Field>
          <div className="flex justify-end">
            <Button variant="primary" disabled={pending || !entry.category.trim()} onClick={() => run(() => entryFromLine(line.id, entry), done)} className="min-h-9">
              Add {incoming ? "income" : "expense"} &amp; match
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Why" hint="Transfers between your own accounts, things already counted elsewhere…">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Transfer to savings" />
          </Field>
          <div className="flex justify-end">
            <Button disabled={pending} onClick={() => run(() => ignoreBankLine(line.id, note), done)} className="min-h-9">
              Set aside
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
