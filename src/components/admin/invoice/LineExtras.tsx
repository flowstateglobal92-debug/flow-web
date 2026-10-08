"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/admin/icons";
import type { TaxInput } from "@/lib/admin/invoice-math";
import { cataloguePrice, docMoney, lineTax, type CatalogueItem, type TaxRate } from "@/lib/admin/invoice-types";

/**
 * The two per-line extras in the invoice editor: picking a saved product or
 * service, and the taxes a line carries.
 */

const taxLabel = (t: TaxInput) => `${t.name} ${Number(t.rate)}%${t.compound ? " on tax" : ""}`;
const sameTax = (a: TaxInput, b: TaxInput) =>
  a.name.trim().toLowerCase() === b.name.trim().toLowerCase() && Number(a.rate) === Number(b.rate) && !!a.compound === !!b.compound;

/** The taxes on one line: chips to remove, a menu to add one of the workspace's rates. */
export function LineTaxes({
  taxes,
  rates,
  onChange,
  label,
}: {
  taxes: TaxInput[];
  rates: TaxRate[];
  onChange: (taxes: TaxInput[]) => void;
  label: string;
}) {
  const addable = rates.filter((r) => !taxes.some((t) => sameTax(t, lineTax(r))));
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={`${label} taxes`}>
      {taxes.length === 0 && <span className="text-[11px] text-sand/80">No tax</span>}
      {taxes.map((t) => (
        <span
          key={`${t.name}${t.rate}${t.compound}`}
          className="inline-flex min-h-7 items-center gap-1 border border-cream/12 bg-cream/[0.04] pl-2 text-[11px] text-cream-2"
        >
          {taxLabel(t)}
          <button
            type="button"
            onClick={() => onChange(taxes.filter((x) => !sameTax(x, t)))}
            aria-label={`Remove ${taxLabel(t)} from ${label.toLowerCase()}`}
            className="flex h-7 w-7 items-center justify-center text-sand transition-colors hover:text-bad-300"
          >
            <Icon.close size={11} />
          </button>
        </span>
      ))}
      {addable.length > 0 && taxes.length < 4 && (
        <select
          value=""
          onChange={(e) => {
            const r = rates.find((x) => x.id === e.target.value);
            if (r) onChange([...taxes, lineTax(r)]);
          }}
          aria-label={`Add a tax to ${label.toLowerCase()}`}
          className="min-h-7 cursor-pointer border border-dashed border-cream/15 bg-transparent px-2 text-[11px] text-sand transition-colors hover:border-cream/30 hover:text-cream focus:outline-none focus:ring-2 focus:ring-terra/25"
        >
          <option value="" className="bg-ink text-cream">
            + Tax
          </option>
          {addable.map((r) => (
            <option key={r.id} value={r.id} className="bg-ink text-cream">
              {taxLabel(lineTax(r))}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** "From catalogue": a searchable list of saved products and services. */
export function CataloguePicker({
  items,
  currency,
  onPick,
}: {
  items: CatalogueItem[];
  currency: string;
  onPick: (item: CatalogueItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term
      ? items.filter((i) => [i.name, i.code, i.details, i.unit].some((x) => x?.toLowerCase().includes(term)))
      : items;
    return list.slice(0, 40);
  }, [items, q]);

  const pick = (item: CatalogueItem) => {
    onPick(item);
    setOpen(false);
    setQ("");
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex min-h-8 items-center gap-1 text-[11.5px] text-sand transition-colors hover:text-cream pointer-coarse:min-h-9"
      >
        <Icon.checklist size={12} /> From catalogue
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-[min(22rem,80vw)] border border-cream/12 bg-ink-2 shadow-[0_20px_50px_-20px_var(--shadow-strong)]">
          <div className="border-b border-cream/[0.08] p-2">
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && shown[0]) {
                  e.preventDefault();
                  pick(shown[0]);
                }
              }}
              placeholder="Search products & services"
              aria-label="Search the catalogue"
              className="w-full border border-cream/10 bg-ink/60 px-2.5 py-1.5 text-[16px] text-cream placeholder:text-sand/55 focus:border-terra/60 focus:outline-none sm:text-[12.5px]"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto scroll-thin py-1" role="listbox" aria-label="Catalogue">
            {shown.length === 0 && <li className="px-3 py-2 text-[12px] text-sand">Nothing matches.</li>}
            {shown.map((item) => {
              const price = cataloguePrice(item, currency);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => pick(item)}
                    className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-cream/[0.05]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] text-cream">{item.name}</span>
                      <span className="block truncate text-[10.5px] text-sand">
                        {[item.code, item.unit && `per ${item.unit}`, item.kind === "product" ? "Product" : "Service"]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[11.5px] text-cream-2 tabular-nums">
                      {price == null ? `no ${currency} price` : docMoney(price, currency)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
