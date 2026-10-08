/**
 * Invoice arithmetic — the live preview's copy of the database's maths.
 *
 * The database (private.invoice_totals, migrations 0013 → 0033) is the source
 * of truth; this exists so the preview can update on every keystroke and the
 * desktop can total a draft offline. Both work the same way so they never
 * disagree by a cent:
 *   line     = round(qty × rate, 2)
 *   subtotal = Σ line
 *   discount = percent ? round(subtotal × value / 100, 2) : value, clamped to [0, subtotal]
 *
 * Lines without taxes (every document before 0032): one rate for the document
 *   tax      = round((subtotal − discount) × rate / 100, 2)
 *   total    = subtotal − discount + tax
 *
 * Lines with taxes (0032): the discount is spread over the lines in
 * proportion, K = (subtotal − discount) / subtotal, and each tax is
 *   round(Σ its lines' base × rate / 100, 2)
 * where a line's base is line × K — plus the line's other taxes for a
 * compound rate — and, when prices include tax, the line's taxes are taken
 * back out first. The total is subtotal − discount (+ the taxes, unless the
 * prices already include them).
 *
 * Quantity and rate are first rounded to their column precision (qty 3 dp,
 * money 2 dp), as Postgres does when it stores them. Rounding is half away
 * from zero (Postgres numeric `round`). The line-tax sums are done in exact
 * integer fractions (BigInt) with one division at the end, exactly as the SQL
 * does them on numerics, so a figure that lands on half a cent rounds the
 * same way in both.
 */

export type TaxInput = { id?: string | null; name: string; rate: number | string; compound?: boolean };

export type LineInput = { quantity: number | string; unit_price: number | string; taxes?: TaxInput[] | null };

export type TotalsInput = {
  items: LineInput[];
  discount_type: "amount" | "percent";
  discount_value: number | string;
  /** The document's single rate — used only when no line carries taxes. */
  tax_rate: number | string;
  tax_label?: string;
  prices_include_tax?: boolean;
};

/** One row of the tax breakdown, as invoices.tax_breakdown stores it. */
export type TaxLine = { name: string; rate: number; compound: boolean; base: number; amount: number };

export type Totals = {
  lines: number[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  /** total − tax: the value before tax (what a tax invoice calls "excluding VAT"). */
  net: number;
  taxes: TaxLine[];
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

/**
 * A line's taxes as the database keeps them (private.clean_item_taxes): a
 * name (≤ 40) and a rate 0–100 (3 dp), compound or not, each tax once, four
 * at most. Unusable entries are dropped here; the database refuses them.
 */
export function cleanTaxes(taxes: TaxInput[] | null | undefined): Required<TaxInput>[] {
  const out: Required<TaxInput>[] = [];
  for (const t of taxes ?? []) {
    if (!t || typeof t !== "object") continue;
    const name = String(t.name ?? "").trim().slice(0, 40);
    const rate = round3(n(t.rate));
    if (!name || rate < 0 || rate > 100 || String(t.rate ?? "").trim() === "") continue;
    const compound = !!t.compound;
    if (out.some((o) => o.name.toLowerCase() === name.toLowerCase() && Number(o.rate) === rate && o.compound === compound)) {
      continue;
    }
    if (out.length >= 4) break;
    out.push({ id: t.id ?? null, name, rate, compound });
  }
  return out;
}

/* ───────────────────────── exact fractions (BigInt) ───────────────────────── */

// BigInt(…) rather than 0n literals: the website compiles for ES2017.
const B0 = BigInt(0);
const B1 = BigInt(1);
const B2 = BigInt(2);
const B100 = BigInt(100);
const B1E3 = BigInt(1000);
const B1E5 = BigInt(100000);
const B1E8 = BigInt(100000000);
const B1E10 = BigInt(10000000000);

type Frac = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => {
  a = a < B0 ? -a : a;
  b = b < B0 ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a || B1;
};
const norm = (f: Frac): Frac => {
  const g = gcd(f.n, f.d);
  return { n: f.n / g, d: f.d / g };
};
const add = (a: Frac, b: Frac): Frac => norm({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
/** n / d rounded half away from zero, to a whole number (both ≥ 0 here). */
const roundDiv = (num: bigint, den: bigint) => {
  const neg = num < B0 !== den < B0;
  const a = num < B0 ? -num : num;
  const b = den < B0 ? -den : den;
  const q = (B2 * a + b) / (B2 * b);
  return neg ? -q : q;
};
const cents = (v: number) => BigInt(Math.round(v * 100));
const milli = (v: number) => BigInt(Math.round(round3(v) * 1000));

/** Line taxes → the breakdown, exactly as private.invoice_totals works it out. */
function lineTaxes(lines: number[], items: LineInput[], subtotal: number, after: number, inclusive: boolean) {
  const S = cents(subtotal);
  const AF = cents(after);
  type Group = { name: string; rate: number; compound: boolean; seen: number; excl: bigint; incl: Frac };
  const groups = new Map<string, Group>();

  items.forEach((item, index) => {
    const taxes = cleanTaxes(item.taxes);
    if (!taxes.length) return;
    const A = cents(lines[index]);
    const R = taxes.filter((t) => !t.compound).reduce((s, t) => s + milli(Number(t.rate)), B0);
    const C = taxes.filter((t) => t.compound).reduce((s, t) => s + milli(Number(t.rate)), B0);
    taxes.forEach((t, j) => {
      const rate = Number(t.rate);
      const key = `${t.name}\u0000${milli(rate)}\u0000${t.compound}`;
      const g = groups.get(key) ?? { name: t.name, rate, compound: t.compound, seen: index * 100 + j + 1, excl: B0, incl: { n: B0, d: B1 } };
      // Prices before tax — the SQL's excl, × 100000 so it stays whole.
      g.excl += t.compound ? A * (B1E5 + R) : A * B1E5;
      // Prices with tax in them — the SQL's incl (currency units), as a fraction.
      g.incl = add(
        g.incl,
        t.compound ? { n: A * B1E3, d: B1E5 + C } : { n: A * B1E8, d: (B1E5 + R) * (B1E5 + C) },
      );
      groups.set(key, g);
    });
  });

  const out: TaxLine[] = [];
  // Plain taxes first, then those charged on them (SSCL before VAT) — the SQL's order.
  for (const g of [...groups.values()].sort((a, b) => Number(a.compound) - Number(b.compound) || a.seen - b.seen)) {
    const r = milli(g.rate);
    let baseCents = B0;
    let amountCents = B0;
    if (S > B0) {
      if (inclusive) {
        baseCents = roundDiv(g.incl.n * AF * B100, g.incl.d * S);
        amountCents = roundDiv(g.incl.n * AF * r, g.incl.d * S * B1E3);
      } else {
        baseCents = roundDiv(g.excl * AF, S * B1E5);
        amountCents = roundDiv(g.excl * AF * r, S * B1E10);
      }
    }
    out.push({ name: g.name, rate: g.rate, compound: g.compound, base: Number(baseCents) / 100, amount: Number(amountCents) / 100 });
  }
  return S > B0 ? out : [];
}

export function computeTotals(input: TotalsInput): Totals {
  const lines = input.items.map(lineAmount);
  const subtotal = round2(lines.reduce((a, b) => a + b, 0));
  const rawDiscount =
    input.discount_type === "percent" ? round2((subtotal * n(input.discount_value)) / 100) : round2(n(input.discount_value));
  const discount = Math.min(Math.max(rawDiscount, 0), subtotal);
  const after = round2(subtotal - discount);
  const taxed = input.items.some((i) => cleanTaxes(i.taxes).length > 0);

  if (taxed) {
    const inclusive = !!input.prices_include_tax;
    const taxes = lineTaxes(lines, input.items, subtotal, after, inclusive);
    const tax = round2(taxes.reduce((a, t) => a + t.amount, 0));
    const total = inclusive ? after : round2(after + tax);
    return { lines, subtotal, discount, tax, total, net: round2(total - tax), taxes };
  }

  const rate = n(input.tax_rate);
  const tax = round2((after * rate) / 100);
  const total = round2(after + tax);
  const taxes: TaxLine[] =
    rate > 0 ? [{ name: input.tax_label?.trim() || "Tax", rate, compound: false, base: after, amount: tax }] : [];
  return { lines, subtotal, discount, tax, total, net: round2(total - tax), taxes };
}

/**
 * Shared parity fixture — the SQL harness asserts the database produces
 * exactly these totals for the same inputs (desktop/test/invoice-math.test.ts
 * runs the browser side).
 */
export const PARITY_FIXTURE: { input: TotalsInput; expect: Omit<Totals, "lines" | "net" | "taxes"> }[] = [
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
  // 0032: line taxes. SSCL then VAT on the amount including SSCL.
  {
    input: {
      items: [{ quantity: 1, unit_price: 100000, taxes: [{ name: "SSCL", rate: 2.5 }, { name: "VAT", rate: 18, compound: true }] }],
      discount_type: "amount",
      discount_value: 0,
      tax_rate: 0,
    },
    expect: { subtotal: 100000, discount: 0, tax: 20950, total: 120950 },
  },
  // The discount spread over a taxed and an untaxed line.
  {
    input: {
      items: [
        { quantity: 1, unit_price: 1000, taxes: [{ name: "VAT", rate: 18 }] },
        { quantity: 1, unit_price: 500 },
      ],
      discount_type: "percent",
      discount_value: 10,
      tax_rate: 0,
    },
    expect: { subtotal: 1500, discount: 150, tax: 162, total: 1512 },
  },
  // Half a cent exactly: 100.25 × 18% = 18.045 → 18.05.
  {
    input: { items: [{ quantity: 1, unit_price: 100.25, taxes: [{ name: "VAT", rate: 18 }] }], discount_type: "amount", discount_value: 0, tax_rate: 0 },
    expect: { subtotal: 100.25, discount: 0, tax: 18.05, total: 118.3 },
  },
  // Prices that include tax, compound: 120,950 back to 100,000 + 2,500 + 18,450.
  {
    input: {
      items: [{ quantity: 1, unit_price: 120950, taxes: [{ name: "SSCL", rate: 2.5 }, { name: "VAT", rate: 18, compound: true }] }],
      discount_type: "amount",
      discount_value: 0,
      tax_rate: 0,
      prices_include_tax: true,
    },
    expect: { subtotal: 120950, discount: 0, tax: 20950, total: 120950 },
  },
];
