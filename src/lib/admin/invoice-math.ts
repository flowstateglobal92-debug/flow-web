/**
 * Invoice arithmetic — the live preview's copy of the database's maths.
 *
 * The database (migration 0013, invoices totals trigger) is the source of
 * truth; this exists so the preview can update on every keystroke. Both work
 * the same way so they never disagree by a cent:
 *   line     = round(qty × rate, 2)
 *   subtotal = Σ line
 *   discount = percent ? round(subtotal × value / 100, 2) : value, clamped to [0, subtotal]
 *   tax      = round((subtotal − discount) × rate / 100, 2)
 *   total    = subtotal − discount + tax
 * Quantity and rate are first rounded to their column precision (qty 3 dp,
 * money 2 dp), as Postgres does when it stores them. Rounding is half away
 * from zero (Postgres numeric `round`) and done on scaled integers to dodge
 * binary floating point (1.005 × 100 = 100.49999…).
 */

export type LineInput = { quantity: number | string; unit_price: number | string };

export type TotalsInput = {
  items: LineInput[];
  discount_type: "amount" | "percent";
  discount_value: number | string;
  tax_rate: number | string;
};

export type Totals = {
  lines: number[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
};

const n = (v: number | string | null | undefined) => {
  const x = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};

/** Round to 2 dp, half away from zero, without float drift. */
export function round2(value: number) {
  const sign = value < 0 ? -1 : 1;
  // toFixed(6) collapses 100.49999999 artefacts before the cent decision.
  const scaled = Number((Math.abs(value) * 100).toFixed(6));
  return (sign * Math.floor(scaled + 0.5)) / 100;
}

/** Quantity is stored as numeric(12,3). */
export function round3(value: number) {
  const sign = value < 0 ? -1 : 1;
  const scaled = Number((Math.abs(value) * 1000).toFixed(6));
  return (sign * Math.floor(scaled + 0.5)) / 1000;
}

/** Inputs are rounded to their column precision first, exactly as Postgres stores them. */
export function lineAmount(item: LineInput) {
  return round2(round3(n(item.quantity)) * round2(n(item.unit_price)));
}

export function computeTotals(input: TotalsInput): Totals {
  const lines = input.items.map(lineAmount);
  const subtotal = round2(lines.reduce((a, b) => a + b, 0));
  const rawDiscount =
    input.discount_type === "percent" ? round2((subtotal * n(input.discount_value)) / 100) : round2(n(input.discount_value));
  const discount = Math.min(Math.max(rawDiscount, 0), subtotal);
  const tax = round2(((subtotal - discount) * n(input.tax_rate)) / 100);
  const total = round2(subtotal - discount + tax);
  return { lines, subtotal, discount, tax, total };
}

/**
 * Shared parity fixture — the SQL harness (tests/0013) asserts the database
 * produces exactly these totals for the same inputs.
 */
export const PARITY_FIXTURE: { input: TotalsInput; expect: Omit<Totals, "lines"> }[] = [
  {
    input: { items: [{ quantity: 1, unit_price: 1.005 }], discount_type: "amount", discount_value: 0, tax_rate: 0 },
    expect: { subtotal: 1.01, discount: 0, tax: 0, total: 1.01 },
  },
  {
    input: {
      items: [
        { quantity: 3, unit_price: 12500 },
        { quantity: 1.5, unit_price: 8000.33 },
      ],
      discount_type: "percent",
      discount_value: 10,
      tax_rate: 18,
    },
    expect: { subtotal: 49500.5, discount: 4950.05, tax: 8019.08, total: 52569.53 },
  },
  {
    input: { items: [{ quantity: 2, unit_price: 100 }], discount_type: "amount", discount_value: 500, tax_rate: 18 },
    expect: { subtotal: 200, discount: 200, tax: 0, total: 0 },
  },
  {
    input: { items: [{ quantity: 3, unit_price: 1.005 }], discount_type: "amount", discount_value: 0, tax_rate: 0 },
    expect: { subtotal: 3.03, discount: 0, tax: 0, total: 3.03 },
  },
  {
    input: { items: [{ quantity: 0.333, unit_price: 99.99 }], discount_type: "percent", discount_value: 12.5, tax_rate: 8 },
    expect: { subtotal: 33.3, discount: 4.16, tax: 2.33, total: 31.47 },
  },
];
