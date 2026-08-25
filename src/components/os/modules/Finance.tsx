"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sleep, useOSLog } from "../OSContext";
import { GhostButton, Icon, KPI, PanelTitle, Pill, PrimaryButton } from "../ui";

/* ───────────── Data ───────────── */
type Status = "Scheduled" | "Due today" | "Late" | "Escalated" | "Paid";
type Instalment = "done" | "current" | "todo";

type Invoice = {
  id: string;
  number: string;
  client: string;
  project: string;
  amount: number;
  due: string;
  status: Status;
  /** Advance / Milestone / Completion. */
  instalments: [Instalment, Instalment, Instalment];
  cheque?: string;
  /** Latest system action shown under the client name. */
  note?: string;
};

const INITIAL: Invoice[] = [
  { id: "i1", number: "#1042", client: "Aria Studio", project: "Brand system", amount: 4800, due: "in 3d", status: "Scheduled", instalments: ["done", "current", "todo"] },
  { id: "i2", number: "#1044", client: "Nova Clinic", project: "Website rebuild", amount: 2900, due: "in 6d", status: "Scheduled", instalments: ["current", "todo", "todo"] },
  { id: "i3", number: "#1039", client: "Bluefin Logistics", project: "Ops automation", amount: 6200, due: "today", status: "Due today", instalments: ["done", "done", "current"] },
  { id: "i4", number: "#1036", client: "Harbour Café", project: "Menu & ordering", amount: 3600, due: "2d late", status: "Late", instalments: ["done", "current", "todo"] },
  { id: "i5", number: "#1031", client: "Solis Realty", project: "Listing portal", amount: 3900, due: "9d late", status: "Late", instalments: ["done", "current", "todo"], cheque: "Post-dated cheque · matures 28 Aug · reminder set" },
  { id: "i6", number: "#1028", client: "Kite Interiors", project: "Studio site", amount: 5400, due: "paid", status: "Paid", instalments: ["done", "done", "done"] },
];

const BASE_COLLECTED = 38_900;

const CADENCE = [
  { label: "Before due", d: "Friendly reminder, 3 days out", result: "2 reminders sent · WhatsApp" },
  { label: "On due", d: "Due-today notice with pay link", result: "Bluefin Logistics reminded" },
  { label: "After due", d: "Second reminder + payment link", result: "Harbour Café · link sent" },
  { label: "Escalate", d: "Owner notified, call task created", result: "Solis Realty escalated" },
];

const MARGIN = [
  { k: "Revenue", v: 52_000, tone: "bg-terra" },
  { k: "Costs", v: 28_600, tone: "bg-cream/40" },
  { k: "Overhead", v: 5_700, tone: "bg-cream/15" },
];
const MARGIN_PCT = 34;

const money = (n: number) => "Rs " + n.toLocaleString("en-US");

const STATUS_TONE: Record<Status, "neutral" | "cream" | "warn" | "terra" | "success"> = {
  Scheduled: "neutral",
  "Due today": "cream",
  Late: "warn",
  Escalated: "terra",
  Paid: "success",
};

/* ───────────── Hooks ───────────── */
/** rAF count-up from the previously displayed value to `target`. */
function useTween(target: number, duration = 700) {
  const [value, setValue] = useState(target);
  const shown = useRef(target);
  useEffect(() => {
    const from = shown.current;
    if (from === target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = reduce ? 1 : Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(from + (target - from) * eased);
      shown.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

/* ───────────── Small pieces ───────────── */
function InstalmentChip({ label, state }: { label: string; state: Instalment }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-[0.08em] ring-1 ${
        state === "done"
          ? "bg-cream/10 text-cream ring-cream/20"
          : state === "current"
            ? "bg-terra/15 text-terra-bright ring-terra/35"
            : "bg-transparent text-sand ring-cream/12"
      }`}
    >
      {state === "done" ? (
        <Icon.check size={10} />
      ) : state === "current" ? (
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terra-bright" />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full ring-1 ring-sand/60" />
      )}
      {label}
    </span>
  );
}

function Donut({ pct }: { pct: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const arc = useRef<SVGCircleElement>(null);
  // Draw the arc in after mount — DOM write only, no state.
  useEffect(() => {
    const el = arc.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.style.strokeDasharray = `${(pct / 100) * c} ${c}`;
    });
    return () => cancelAnimationFrame(id);
  }, [pct, c]);
  return (
    <div className="relative h-[84px] w-[84px] shrink-0">
      <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90">
        <circle cx="42" cy="42" r={r} fill="none" strokeWidth="7" className="stroke-cream/10" />
        <circle
          ref={arc}
          cx="42"
          cy="42"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          className="stroke-terra transition-[stroke-dasharray] duration-[900ms] ease-[var(--ease-flow)]"
          style={{ strokeDasharray: `0 ${c}` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-[17px] leading-none text-cream tabular-nums">{pct}%</span>
        <span className="mt-0.5 text-[9px] uppercase tracking-[0.14em] text-sand">margin</span>
      </div>
    </div>
  );
}

/* ───────────── Module ───────────── */
export default function Finance() {
  const log = useOSLog();
  const [invoices, setInvoices] = useState<Invoice[]>(INITIAL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cad, setCad] = useState<{ step: number; done: boolean } | null>(null);
  const runId = useRef(0);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const selected = invoices.find((i) => i.id === selectedId) ?? null;

  const totals = useMemo(() => {
    const open = invoices.filter((i) => i.status !== "Paid");
    const paidNow = invoices
      .filter((i) => i.status === "Paid" && INITIAL.find((x) => x.id === i.id)?.status !== "Paid")
      .reduce((a, i) => a + i.amount, 0);
    return {
      outstanding: open.reduce((a, i) => a + i.amount, 0),
      collected: BASE_COLLECTED + paidNow,
      overdue: invoices.filter((i) => i.status === "Late" || i.status === "Escalated").length,
    };
  }, [invoices]);

  const outstanding = useTween(totals.outstanding);
  const collected = useTween(totals.collected);
  const overdue = useTween(totals.overdue, 400);

  const patch = useCallback((id: string, p: Partial<Invoice>) => {
    setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));
  }, []);

  const flashRow = useCallback((id: string) => {
    const el = rowRefs.current[id];
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [{ backgroundColor: "rgba(243,233,220,0.2)" }, { backgroundColor: "rgba(243,233,220,0)" }],
      { duration: 1400, easing: "cubic-bezier(0.22,1,0.36,1)" },
    );
  }, []);

  const runCadence = useCallback(async () => {
    const id = ++runId.current;
    setInvoices(INITIAL);
    setSelectedId(null);
    setCad({ step: 0, done: false });

    for (let i = 0; i < CADENCE.length; i++) {
      await sleep(i === 0 ? 450 : 700);
      if (runId.current !== id) return;
      if (i === 0) {
        patch("i1", { note: "Reminder sent (WhatsApp)" });
        patch("i2", { note: "Reminder sent (WhatsApp)" });
        log({ module: "finance", text: "Pre-due reminders sent · Aria Studio, Nova Clinic", tag: "WhatsApp" }, 6);
      } else if (i === 1) {
        patch("i3", { note: "Reminder sent · pay link included" });
        log({ module: "finance", text: "Due-today reminder · Bluefin Logistics #1039", tag: "Rs 6,200" }, 4);
      } else if (i === 2) {
        patch("i4", { note: "2nd reminder + payment link" });
        log({ module: "finance", text: "Second reminder + payment link · Harbour Café #1036", tag: "Rs 3,600" }, 5);
      } else {
        patch("i5", { status: "Escalated", note: "Owner notified · call task created" });
        log(
          { module: "finance", text: "Escalated · Solis Realty #1031 — owner notified, call task created", tag: "9d late", tone: "warn" },
          8,
        );
      }
      setCad({ step: i + 1, done: false });
    }

    await sleep(900);
    if (runId.current !== id) return;
    patch("i4", { status: "Paid", due: "paid", note: "Paid via payment link · just now", instalments: ["done", "done", "todo"] });
    flashRow("i4");
    setCad({ step: CADENCE.length, done: true });
    log({ module: "finance", text: "Payment received · Harbour Café #1036", tag: "Rs 3,600", tone: "success" }, 12);
  }, [log, patch, flashRow]);

  const reset = () => {
    runId.current++;
    setInvoices(INITIAL);
    setCad(null);
    setSelectedId(null);
  };

  const sendPdf = (inv: Invoice) => {
    patch(inv.id, { note: "Branded PDF invoice sent · just now" });
    log({ module: "finance", text: `Branded PDF invoice ${inv.number} sent · ${inv.client}`, tag: money(inv.amount) }, 7);
  };

  const running = !!cad && !cad.done;
  const openCount = invoices.filter((i) => i.status !== "Paid").length;

  return (
    <div className="flex h-full flex-col p-4 sm:p-5">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-medium text-cream sm:text-lg">Financial operations</h3>
            <Pill tone="terra">
              <Icon.finance size={11} /> Cash flow
            </Pill>
          </div>
          <p className="mt-1 text-[12.5px] text-sand">
            Invoices, instalments and cheques live next to the project —{" "}
            <span className="text-cream-2">press Run cadence and watch collections happen.</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 font-mono text-[11px] text-sand tabular-nums">
            {openCount} open · {money(totals.outstanding)} outstanding
          </span>
          <GhostButton onClick={reset}>Reset</GhostButton>
        </div>
      </div>

      {/* KPIs */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KPI label="Outstanding" value={money(outstanding)} />
        <KPI label="Collected this month" value={money(collected)} delta="+12%" />
        <KPI
          label="Overdue"
          value={
            <>
              {overdue} <span className="text-[13px] text-sand">{overdue === 1 ? "invoice" : "invoices"}</span>
            </>
          }
        />
        <KPI label="Project margin" value={`${MARGIN_PCT}%`} />
      </div>

      {/* Main */}
      <div className="grid grid-cols-1 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Invoices */}
        <div className="flex min-w-0 flex-col rounded-none border border-cream/[0.07] bg-ink/25 p-2">
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-terra" />
              <span className="text-[12px] font-medium uppercase tracking-[0.12em] text-cream-2">Invoices</span>
              <span className="font-mono text-[11px] text-sand tabular-nums">{invoices.length}</span>
            </div>
            <span className="text-[10.5px] text-sand">
              <span className="sm:hidden">Swipe · tap a row</span>
              <span className="hidden sm:inline">Click a row for instalments</span>
            </span>
          </div>

          <div className="scroll-thin scroll-x-fade overflow-x-auto" data-lenis-prevent>
            <table className="w-full min-w-[560px] border-collapse text-left text-[12.5px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.16em] text-sand">
                  <th className="px-2 pb-2 pt-1 font-medium">#</th>
                  <th className="px-2 pb-2 pt-1 font-medium">Client</th>
                  <th className="px-2 pb-2 pt-1 font-medium">Project</th>
                  <th className="px-2 pb-2 pt-1 text-right font-medium">Amount</th>
                  <th className="px-2 pb-2 pt-1 font-medium">Due</th>
                  <th className="px-2 pb-2 pt-1 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const isSel = selectedId === inv.id;
                  const late = inv.status === "Late" || inv.status === "Escalated";
                  return (
                    <tr
                      key={inv.id}
                      ref={(el) => {
                        rowRefs.current[inv.id] = el;
                      }}
                      onClick={() => setSelectedId(isSel ? null : inv.id)}
                      className={`cursor-pointer border-t border-cream/[0.06] transition-colors ${
                        isSel ? "bg-cream/[0.06]" : "hover:bg-cream/[0.04]"
                      }`}
                    >
                      <td className="px-2 py-2.5 align-top font-mono text-[11px] text-sand tabular-nums">{inv.number}</td>
                      <td className="px-2 py-2.5 align-top">
                        <span className={`block font-medium leading-tight ${inv.status === "Paid" ? "text-cream-2" : "text-cream"}`}>
                          {inv.client}
                        </span>
                        {inv.note && (
                          <span className="rise-in mt-0.5 flex items-center gap-1 text-[10.5px] text-terra-bright">
                            <Icon.send size={10} /> {inv.note}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 align-top text-cream-2">{inv.project}</td>
                      <td className="px-2 py-2.5 text-right align-top font-mono text-[12px] text-cream tabular-nums">{money(inv.amount)}</td>
                      <td className={`px-2 py-2.5 align-top text-[12px] tabular-nums ${late ? "text-amber-200/90" : "text-sand"}`}>{inv.due}</td>
                      <td className="px-2 py-2.5 align-top">
                        <Pill tone={STATUS_TONE[inv.status]}>{inv.status}</Pill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Detail strip */}
          {selected && (
            <div className="rise-in relative mt-2 rounded-none border border-cream/[0.08] bg-cream/[0.03] px-3 py-2.5">
              <button
                type="button"
                aria-label="Close"
                onClick={() => setSelectedId(null)}
                className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-none text-sand transition-colors hover:bg-cream/10 hover:text-cream"
              >
                ×
              </button>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pr-7">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-sand">Instalments</p>
                  <p className="mt-0.5 truncate text-[12.5px] text-cream">
                    {selected.number} · {selected.client}{" "}
                    <span className="text-sand">— {selected.project}</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <InstalmentChip label="Advance" state={selected.instalments[0]} />
                  <InstalmentChip label="Milestone" state={selected.instalments[1]} />
                  <InstalmentChip label="Completion" state={selected.instalments[2]} />
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <GhostButton onClick={() => sendPdf(selected)} disabled={selected.status === "Paid"}>
                    <Icon.doc size={12} /> Send branded PDF
                  </GhostButton>
                </div>
              </div>
              {selected.cheque && (
                <p className="mt-2 flex items-center gap-1.5 border-t border-cream/[0.06] pt-2 text-[11.5px] text-cream-2">
                  <span className="text-terra-bright">
                    <Icon.calendar size={12} />
                  </span>
                  {selected.cheque}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Cadence + margin */}
        <div className="flex flex-col gap-3">
          <div className="glass-inset relative overflow-hidden p-4">
            <div className="glow-terra pointer-events-none absolute -right-12 -top-12 h-32 w-32 opacity-30" />
            <PanelTitle title="Collection cadence" hint="Routine steps run themselves. Exceptions come to you." />

            <ol className="relative space-y-3">
              {CADENCE.map((s, i) => {
                const state = !cad ? "todo" : i < cad.step ? "done" : i === cad.step && !cad.done ? "active" : "todo";
                return (
                  <li key={s.label} className="relative flex items-start gap-3">
                    {i < CADENCE.length - 1 && (
                      <span
                        className={`absolute left-[9px] top-6 h-[calc(100%-8px)] w-px transition-colors duration-500 ${
                          state === "done" ? "bg-terra/60" : "bg-cream/10"
                        }`}
                      />
                    )}
                    <span
                      className={`relative z-[1] mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ring-1 transition-all duration-500 ${
                        state === "done"
                          ? "bg-terra text-cream ring-terra"
                          : state === "active"
                            ? "bg-terra/20 text-terra-bright ring-terra/60"
                            : "bg-ink text-sand ring-cream/15"
                      }`}
                    >
                      {state === "done" ? (
                        <Icon.check size={11} />
                      ) : state === "active" ? (
                        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terra-bright" />
                      ) : (
                        i + 1
                      )}
                    </span>
                    <span className={`min-w-0 transition-opacity duration-500 ${state === "todo" ? "opacity-50" : "opacity-100"}`}>
                      <span className="block font-mono text-[10.5px] uppercase tracking-[0.16em] text-cream">{s.label}</span>
                      <span className="block text-[11.5px] text-sand">{state === "done" ? s.result : s.d}</span>
                    </span>
                  </li>
                );
              })}
            </ol>

            {cad?.done ? (
              <div className="rise-in mt-3 rounded-none border border-terra/30 bg-terra/10 px-3 py-2 text-[12px] text-cream">
                Harbour Café paid <span className="text-terra-bright">Rs 3,600</span> from the link. One invoice left with you.
              </div>
            ) : null}

            <PrimaryButton className="mt-3 w-full" onClick={() => void runCadence()} disabled={running}>
              <Icon.play size={13} /> {running ? "Running cadence…" : cad?.done ? "Run again" : "Run cadence"}
            </PrimaryButton>
          </div>

          <div className="glass-inset p-4">
            <PanelTitle title="Margin" hint="Profit tracked per project, live." />
            <div className="flex items-center gap-4">
              <Donut pct={MARGIN_PCT} />
              <ul className="min-w-0 flex-1 space-y-1.5">
                {MARGIN.map((m) => (
                  <li key={m.k} className="flex items-center justify-between gap-2 text-[11.5px]">
                    <span className="flex items-center gap-2 text-sand">
                      <span className={`h-1.5 w-1.5 rounded-full ${m.tone}`} />
                      {m.k}
                    </span>
                    <span className="font-mono text-cream-2 tabular-nums">{money(m.v)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-3 flex items-center gap-1.5 border-t border-cream/[0.06] pt-2.5 text-[11px] text-sand">
              <Icon.user size={12} />
              Private commission balance · <span className="text-cream-2">visible only to Dilan</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
