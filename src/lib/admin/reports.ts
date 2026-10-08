/**
 * Pure maths behind Reports — periods, the cash-flow forecast and CSV.
 *
 * No imports and no clock: everything takes `YYYY-MM-DD` strings and plain
 * numbers, so the same code runs in the page, in the browser when the basis
 * toggle flips, and under plain `node` in the fixture test. Dates are
 * calendar days (Colombo "today" comes from the database as `as_of`), so all
 * arithmetic is done on UTC midnights and never touches the runtime's zone.
 */

/* ──────────────────────────────── dates ──────────────────────────────── */

const DAY = 86_400_000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const utc = (day: string) => Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(utc(v));

export const plusDays = (day: string, n: number) => iso(utc(day) + n * DAY);

/** Whole days from `a` to `b`. */
export const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DAY);

/** First day of the month `n` months after the one `day` falls in. */
export function monthStart(day: string, n = 0) {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1 + n;
  return iso(Date.UTC(y + Math.floor(m / 12), ((m % 12) + 12) % 12, 1));
}

/** `2026-10-01` → `Oct` (or `Oct 26` with the year). */
export function monthShort(day: string, withYear = false) {
  const m = MONTHS[Number(day.slice(5, 7)) - 1] ?? "";
  return withYear ? `${m} ${day.slice(2, 4)}` : m;
}

/** `2026-10-14` → `14 Oct` — a calendar day, no zone involved. */
export function dayShort(day: string) {
  return `${day.slice(8, 10)} ${MONTHS[Number(day.slice(5, 7)) - 1] ?? ""}`;
}

/* ─────────────────────────────── periods ─────────────────────────────── */

export type Period = "month" | "quarter" | "year" | "tax_year" | "custom";

export const PERIODS: { value: Period; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
  { value: "tax_year", label: "Tax year" },
  { value: "custom", label: "Custom" },
];

/**
 * The period containing `at`, inclusive on both ends. A tax year starts in
 * `fyStart` (invoice_settings.fiscal_year_start_month; April in Sri Lanka).
 */
export function periodRange(period: Exclude<Period, "custom">, at: string, fyStart = 4) {
  const y = Number(at.slice(0, 4));
  const m = Number(at.slice(5, 7)) - 1;
  if (period === "tax_year") {
    const start = fyStart - 1;
    const from = iso(Date.UTC(m >= start ? y : y - 1, start, 1));
    return { from, to: plusDays(monthStart(from, 12), -1) };
  }
  const startMonth = period === "month" ? m : period === "quarter" ? m - (m % 3) : 0;
  const length = period === "month" ? 1 : period === "quarter" ? 3 : 12;
  const from = iso(Date.UTC(y, startMonth, 1));
  const to = plusDays(monthStart(from, length), -1);
  return { from, to };
}

/** Step a period backwards or forwards by `n` whole periods. */
export function shiftPeriod(period: Exclude<Period, "custom">, at: string, n: number, fyStart = 4) {
  const months = period === "month" ? 1 : period === "quarter" ? 3 : 12;
  return periodRange(period, monthStart(at, months * n), fyStart).from;
}

/** "October 2026", "Q4 2026", "2026", "2026/27", or "01 Oct 2026 – 15 Nov 2026". */
export function periodLabel(period: Period, from: string, to: string) {
  const y = from.slice(0, 4);
  const m = Number(from.slice(5, 7)) - 1;
  if (period === "month") return `${MONTHS_LONG[m]} ${y}`;
  if (period === "quarter") return `Q${Math.floor(m / 3) + 1} ${y}`;
  if (period === "year") return y;
  if (period === "tax_year") return m === 0 ? y : `${y}/${String((Number(y) + 1) % 100).padStart(2, "0")}`;
  return `${dayShort(from)} ${from.slice(0, 4)} – ${dayShort(to)} ${to.slice(0, 4)}`;
}

/** The previous period of the same length, for a custom range. */
export function previousRange(from: string, to: string) {
  const length = daysBetween(from, to) + 1;
  return { from: plusDays(from, -length), to: plusDays(from, -1) };
}

/** `+12%` style change; null when there's nothing to compare against. */
export function pctChange(current: number, previous: number) {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/* ──────────────────────────────── P&L ────────────────────────────────── */

export type MonthRow = { month: string; income: number; expense: number; net: number };

/** Every month from `from` to `to`, zero-filled where the ledger was quiet. */
export function fillMonths(from: string, to: string, rows: MonthRow[]): MonthRow[] {
  const byMonth = new Map(rows.map((r) => [r.month.slice(0, 7), r]));
  const out: MonthRow[] = [];
  for (let m = monthStart(from); m <= to && out.length < 240; m = monthStart(m, 1)) {
    const r = byMonth.get(m.slice(0, 7));
    const income = r ? Number(r.income) || 0 : 0;
    const expense = r ? Number(r.expense) || 0 : 0;
    out.push({ month: m, income, expense, net: r && r.net != null ? Number(r.net) || 0 : income - expense });
  }
  return out;
}

/* ───────────────────────────── aging ─────────────────────────────────── */

export const AGING_BUCKETS = [
  { key: "current", label: "Current", hint: "Not yet due" },
  { key: "d1_30", label: "1–30 days", hint: "1 to 30 days overdue" },
  { key: "d31_60", label: "31–60 days", hint: "31 to 60 days overdue" },
  { key: "d61_90", label: "61–90 days", hint: "61 to 90 days overdue" },
  { key: "d90_plus", label: "90+ days", hint: "More than 90 days overdue" },
] as const;

export type AgingBucket = (typeof AGING_BUCKETS)[number]["key"];

export function agingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d1_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90_plus";
}

/* ─────────────────────────── cash-flow forecast ──────────────────────── */

/** `report_cashflow_inputs()` — every amount in LKR. */
export type CashflowInputs = {
  as_of: string;
  opening_balance: number;
  opening_balance_on: string | null;
  receivables: { id: string; number: string | null; client: string | null; due_date: string | null; balance: number }[];
  recurring: { schedule_id: string; name: string; run_on: string; amount: number }[];
  /** Open supplier bills (0040), by due date. */
  payables?: { id: string; reference: string | null; supplier: string | null; due_date: string | null; balance: number }[];
  /** Bills recurring expenses will raise (0040), on their due day. */
  recurring_bills?: { schedule_id: string; name: string; due_on: string; amount: number }[];
  expense_monthly_avg: number;
  budgets_monthly_total: number;
};

export type ForecastBasis = "average" | "budgets";

export type ForecastOptions = {
  basis: ForecastBasis;
  weeks?: number;
  /** Count overdue invoices as collected in week 1. Off = they're shown as "at risk" only. */
  includeOverdue?: boolean;
  /** Days from a recurring run to the cash arriving (the invoice's payment terms). */
  recurringLagDays?: number;
};

export type ForecastWeek = {
  week: number;
  start: string;
  end: string;
  receivables: number;
  recurring: number;
  inflow: number;
  /** Supplier bills due that week (open ones and recurring) — part of `outflow`. */
  bills: number;
  outflow: number;
  net: number;
  balance: number;
};

export type Forecast = {
  asOf: string;
  opening: number;
  weeklyOutflow: number;
  monthlyOutflow: number;
  weeks: ForecastWeek[];
  /** Overdue on `as_of` — collected in week 1 only when `includeOverdue`. */
  atRisk: { total: number; count: number };
  /** Due or arriving after the horizon — left out. */
  beyond: { total: number; count: number };
  /** Bills already past due on `as_of` — counted in week 1. */
  billsOverdue: { total: number; count: number };
  totals: { inflow: number; outflow: number; net: number };
  closing: number;
  lowest: { week: number; balance: number };
};

/** Money is summed in cents so twelve weeks of floats never drift. */
const cents = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const rupees = (c: number) => c / 100;

/**
 * Twelve weekly buckets starting on `as_of`: week 1 is as_of … as_of+6.
 *
 * Inflows: each open invoice's balance lands in the week of its due date (no
 * due date = due now); recurring runs land `recurringLagDays` after they run.
 * Outflows: a flat weekly burn — the trailing 3-month expense average (bill
 * payments left out) or the active budgets, both monthly figures × 12 ⁄ 52 —
 * plus supplier bills in the week they fall due (overdue ones in week 1,
 * recurring ones on the day they'll be due). The running balance starts from
 * the stored opening balance.
 */
export function forecastCashflow(inputs: CashflowInputs, options: ForecastOptions): Forecast {
  const weeks = Math.max(1, Math.min(52, Math.floor(options.weeks ?? 12)));
  const lag = Math.max(0, Math.floor(options.recurringLagDays ?? 0));
  const asOf = inputs.as_of;

  const monthly = cents(options.basis === "budgets" ? inputs.budgets_monthly_total : inputs.expense_monthly_avg);
  const weekly = Math.round((Math.max(0, monthly) * 12) / 52);

  const recv = new Array<number>(weeks).fill(0);
  const rec = new Array<number>(weeks).fill(0);
  const bills = new Array<number>(weeks).fill(0);
  let billsOverdue = 0;
  let billsOverdueCount = 0;
  let atRisk = 0;
  let atRiskCount = 0;
  let beyond = 0;
  let beyondCount = 0;

  const slot = (day: string) => Math.floor(daysBetween(asOf, day) / 7);

  for (const r of inputs.receivables ?? []) {
    const amount = cents(r.balance);
    if (amount <= 0) continue;
    const due = isDay(r.due_date) ? r.due_date : asOf;
    if (due < asOf) {
      atRisk += amount;
      atRiskCount += 1;
      if (options.includeOverdue) recv[0] += amount;
      continue;
    }
    const i = slot(due);
    if (i < weeks) recv[i] += amount;
    else {
      beyond += amount;
      beyondCount += 1;
    }
  }

  for (const r of inputs.recurring ?? []) {
    const amount = cents(r.amount);
    if (amount <= 0 || !isDay(r.run_on)) continue;
    const arrives = plusDays(r.run_on, lag);
    const i = Math.max(0, slot(arrives));
    if (i < weeks) rec[i] += amount;
    else {
      beyond += amount;
      beyondCount += 1;
    }
  }

  for (const b of inputs.payables ?? []) {
    const amount = cents(b.balance);
    if (amount <= 0) continue;
    const due = isDay(b.due_date) ? b.due_date : asOf;
    if (due < asOf) {
      billsOverdue += amount;
      billsOverdueCount += 1;
      bills[0] += amount;
      continue;
    }
    const i = slot(due);
    if (i < weeks) bills[i] += amount;
  }
  for (const b of inputs.recurring_bills ?? []) {
    const amount = cents(b.amount);
    if (amount <= 0 || !isDay(b.due_on)) continue;
    const i = Math.max(0, slot(b.due_on));
    if (i < weeks) bills[i] += amount;
  }

  const opening = cents(inputs.opening_balance);
  let balance = opening;
  let lowest = { week: 0, balance: opening };
  let inflowTotal = 0;
  let outflowTotal = 0;

  const out: ForecastWeek[] = [];
  for (let i = 0; i < weeks; i++) {
    const inflow = recv[i] + rec[i];
    const outflow = weekly + bills[i];
    const net = inflow - outflow;
    balance += net;
    inflowTotal += inflow;
    outflowTotal += outflow;
    if (balance < lowest.balance) lowest = { week: i + 1, balance };
    out.push({
      week: i + 1,
      start: plusDays(asOf, i * 7),
      end: plusDays(asOf, i * 7 + 6),
      receivables: rupees(recv[i]),
      recurring: rupees(rec[i]),
      inflow: rupees(inflow),
      bills: rupees(bills[i]),
      outflow: rupees(outflow),
      net: rupees(net),
      balance: rupees(balance),
    });
  }

  return {
    asOf,
    opening: rupees(opening),
    weeklyOutflow: rupees(weekly),
    monthlyOutflow: rupees(monthly),
    weeks: out,
    atRisk: { total: rupees(atRisk), count: atRiskCount },
    beyond: { total: rupees(beyond), count: beyondCount },
    billsOverdue: { total: rupees(billsOverdue), count: billsOverdueCount },
    totals: { inflow: rupees(inflowTotal), outflow: rupees(outflowTotal), net: rupees(inflowTotal - outflowTotal) },
    closing: rupees(balance),
    lowest: { week: lowest.week, balance: rupees(lowest.balance) },
  };
}

/* ──────────────────────────────── CSV ────────────────────────────────── */

export type CsvCell = string | number | null | undefined;

/**
 * RFC 4180 CSV. Text that a spreadsheet would run as a formula (`=`, `+`,
 * `-`, `@` …) gets a leading apostrophe — client names come from people.
 */
export function toCSV(rows: CsvCell[][]) {
  const cell = (v: CsvCell) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "";
    const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
