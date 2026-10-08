/**
 * Document number patterns — the browser's copy of
 * private.format_document_number / private.number_period (migration 0030),
 * for the settings preview. The database numbers documents; this only shows
 * what it will do.
 *
 *   {PREFIX}  the kind's prefix (INV, QT, CN)
 *   {YYYY} {YY} {MM} {MON}  the document's date (MON = JUL)
 *   {FY}      the tax year it falls in: 2026-27 (or 2026 when it starts in January)
 *   {SEQ}     the running number; {SEQ:4} pads it to 4 digits
 */

export type NumberReset = "never" | "year" | "tax_year" | "month";
export type NumberedKind = "invoice" | "quote" | "credit_note";

export const NUMBER_RESETS: { value: NumberReset; label: string; hint: string }[] = [
  { value: "never", label: "Never", hint: "One running count (Sri Lankan tax invoices must be continuous)" },
  { value: "year", label: "Each year", hint: "Starts again at 1 every January" },
  { value: "tax_year", label: "Each tax year", hint: "Starts again at 1 when the tax year turns" },
  { value: "month", label: "Each month", hint: "Starts again at 1 every month" },
];

export const NUMBER_TOKENS: { token: string; label: string }[] = [
  { token: "{PREFIX}", label: "Prefix" },
  { token: "{YYYY}", label: "Year (2026)" },
  { token: "{YY}", label: "Year (26)" },
  { token: "{MM}", label: "Month (07)" },
  { token: "{MON}", label: "Month (JUL)" },
  { token: "{FY}", label: "Tax year (2026-27)" },
  { token: "{SEQ:4}", label: "Number (0001)" },
  { token: "{SEQ}", label: "Number (1)" },
];

export const NUMBER_PRESETS: { label: string; format: string }[] = [
  { label: "INV-0001", format: "{PREFIX}-{SEQ:4}" },
  { label: "INV-2026-0001", format: "{PREFIX}-{YYYY}-{SEQ:4}" },
  { label: "INV/2026-27/0001", format: "{PREFIX}/{FY}/{SEQ:4}" },
  { label: "26JUL_BR03_1 (SL tax invoice)", format: "{YY}{MON}_BR03_{SEQ}" },
];

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function parts(dateISO: string) {
  const [y, m] = dateISO.slice(0, 10).split("-").map(Number);
  return { y, m };
}

/** First year of the tax year a date falls in. */
export function fiscalYearOf(dateISO: string, fyStart = 4) {
  const { y, m } = parts(dateISO);
  return m >= fyStart ? y : y - 1;
}

/** Same as private.number_period: '' (never), '2026', 'FY2026' or '2026-07'. */
export function numberPeriod(reset: NumberReset, dateISO: string, fyStart = 4) {
  const { y, m } = parts(dateISO);
  if (reset === "year") return String(y);
  if (reset === "month") return `${y}-${String(m).padStart(2, "0")}`;
  if (reset === "tax_year") return `FY${fiscalYearOf(dateISO, fyStart)}`;
  return "";
}

/** Same output as private.format_document_number. */
export function formatDocumentNumber(format: string, prefix: string, seq: number, dateISO: string, fyStart = 4) {
  const { y, m } = parts(dateISO);
  const fy = fiscalYearOf(dateISO, fyStart);
  let v = (format || "{PREFIX}-{SEQ:4}")
    .split("{PREFIX}").join(prefix.trim())
    .split("{YYYY}").join(String(y))
    .split("{YY}").join(String(y).slice(-2))
    .split("{MM}").join(String(m).padStart(2, "0"))
    .split("{MON}").join(MONTHS[m - 1])
    .split("{FY}").join(fyStart === 1 ? String(fy) : `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`);
  v = v.replace(/\{SEQ:([0-9]{1,2})\}/g, (_, w: string) => String(seq).padStart(Number(w), "0"));
  return v.split("{SEQ}").join(String(seq));
}

/** Why a pattern can't be saved, or null. Mirrors invoice_settings_numbering_check. */
export function checkNumberFormat(format: string): string | null {
  const f = format.trim();
  if (f.length < 5) return "Make the pattern at least 5 characters.";
  if (f.length > 60) return "Keep the pattern to 60 characters.";
  if (!f.includes("{SEQ")) return "Include {SEQ} (or {SEQ:4}) — the running number.";
  if (/\{(?!PREFIX\}|YYYY\}|YY\}|MM\}|MON\}|FY\}|SEQ\}|SEQ:[0-9]{1,2}\})[^}]*\}/.test(f)) {
    return "One of the {…} tokens isn't one of the list below.";
  }
  return null;
}

/** Sri Lanka's tax-invoice serial rules (from 1 July 2026): ≤ 40 characters, no spaces. */
export function slSerialWarning(sample: string): string | null {
  if (/\s/.test(sample)) return "Tax invoice serials can't contain spaces.";
  if (sample.length > 40) return "Tax invoice serials are 40 characters at most.";
  return null;
}
