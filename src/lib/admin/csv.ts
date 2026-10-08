/**
 * Reading CSV files people bring in — bank statements (0041) and, later,
 * imports. RFC 4180 (quoted fields, doubled quotes, line breaks in quotes),
 * a byte-order mark, ; or tab separators, and the ways banks write dates and
 * amounts: 2026-10-03, 03/10/2026, 03-Oct-2026; 1,234.56, (1,234.56),
 * 1234.56 DR, debit and credit in separate columns. Pure — runs anywhere.
 */

/** Rows of cells. The separator is whichever of , ; or tab the first line uses most. */
export function parseCSV(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n/) === -1 ? src.length : src.search(/\r?\n/));
  const sep = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (c === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

export type DateFormat = "ymd" | "dmy" | "mdy";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
const valid = (y: number, m: number, d: number) =>
  y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();

/** A bank's date as YYYY-MM-DD, or null. Month names win over the format; two-digit years are 20xx. */
export function parseDate(value: string, format: DateFormat = "dmy"): string | null {
  const v = value.trim();
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  m = v.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,4})[A-Za-z]*[-/. ,]+(\d{2,4})/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = Number(m[1]);
    return mo && valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const [d, mo] = format === "mdy" ? [b, a] : [a, b];
    return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  return null;
}

/** Which day/month order a column of dates uses: a day over 12 decides it. */
export function guessDateFormat(values: string[]): DateFormat {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    if (Number(m[1]) > 12) dmy++;
    if (Number(m[2]) > 12) mdy++;
  }
  if (values.some((v) => /^\d{4}[-/.]/.test(v.trim()))) return "ymd";
  return mdy > dmy ? "mdy" : "dmy";
}

/**
 * An amount: "1,234.56" → 1234.56, "(1,234.56)" or "-1,234.56" → −1234.56,
 * "1,234.56 DR" → −1234.56, "1,234.56 CR" → 1234.56, "" → null.
 */
export function parseAmount(value: string): number | null {
  let v = value.trim().replace(/\s+/g, " ");
  if (!v || v === "-") return null;
  let sign = 1;
  if (/\bDR\.?$/i.test(v)) {
    sign = -1;
    v = v.replace(/\s*DR\.?$/i, "");
  } else if (/\bCR\.?$/i.test(v)) {
    v = v.replace(/\s*CR\.?$/i, "");
  }
  if (/^\(.*\)$/.test(v)) {
    sign = -sign;
    v = v.slice(1, -1);
  }
  v = v.replace(/^(LKR|Rs\.?|USD|\$)\s*/i, "");
  if (v.startsWith("-")) {
    sign = -sign;
    v = v.slice(1);
  }
  v = v.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  return sign * Math.round(Number(v) * 100) / 100;
}

export type BankColumns = {
  date: number;
  description: number;
  reference: number | null;
  /** One signed column… */
  amount: number | null;
  /** …or money out and money in apart. */
  debit: number | null;
  credit: number | null;
  balance: number | null;
};

/** Best guess at which column is which, from the header row. */
export function guessBankColumns(header: string[]): BankColumns {
  const h = header.map((x) => x.toLowerCase());
  const find = (...words: RegExp[]) => {
    const i = h.findIndex((x) => words.some((w) => w.test(x)));
    return i === -1 ? null : i;
  };
  return {
    date: find(/^(txn |transaction |posting |value )?date/, /date/) ?? 0,
    description: find(/descr|narrat|particular|details|remark|memo/) ?? 1,
    reference: find(/ref|cheque|chq|instrument/),
    amount: find(/^amount$|^amount \(|transaction amount/),
    debit: find(/debit|withdraw|money out|^dr$|paid out/),
    credit: find(/credit|deposit|money in|^cr$|paid in/),
    balance: find(/balance/),
  };
}

export type BankRow = { posted_on: string; description: string; reference: string | null; amount: number; balance: number | null };

/** Statement rows from parsed CSV with a column map. Rows that aren't transactions are left out. */
export function bankRows(rows: string[][], cols: BankColumns, format: DateFormat): { rows: BankRow[]; skipped: number } {
  const out: BankRow[] = [];
  let skipped = 0;
  for (const r of rows) {
    const posted = parseDate(r[cols.date] ?? "", format);
    let amount: number | null = null;
    if (cols.amount != null) amount = parseAmount(r[cols.amount] ?? "");
    else {
      const out_ = cols.debit != null ? parseAmount(r[cols.debit] ?? "") : null;
      const in_ = cols.credit != null ? parseAmount(r[cols.credit] ?? "") : null;
      amount = (in_ ? Math.abs(in_) : 0) - (out_ ? Math.abs(out_) : 0) || null;
    }
    if (!posted || amount == null || amount === 0) {
      skipped++;
      continue;
    }
    out.push({
      posted_on: posted,
      description: (r[cols.description] ?? "").slice(0, 500),
      reference: cols.reference != null ? (r[cols.reference] ?? "").slice(0, 120) || null : null,
      amount,
      balance: cols.balance != null ? parseAmount(r[cols.balance] ?? "") : null,
    });
  }
  return { rows: out, skipped };
}

/**
 * The fingerprint that makes an import repeatable: the line's own content
 * plus which occurrence of that identical line it is in the file (two equal
 * coffees on one day are two lines).
 */
export function fingerprints(rows: BankRow[]) {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const key = `${r.posted_on}|${r.amount.toFixed(2)}|${r.description.toLowerCase().replace(/\s+/g, " ")}|${(r.reference ?? "").toLowerCase()}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return `${key}|${n}`.slice(0, 600);
  });
}
