"use client";

import { useMemo, useState } from "react";
import Modal from "@/components/admin/Modal";
import { Icon } from "@/components/admin/icons";
import { Tabs } from "@/components/admin/Tabs";
import { useAction } from "@/components/admin/useAction";
import { Badge, Button, EmptyState, Field, Input, Panel, Select, Textarea } from "@/components/admin/ui";
import { CURRENCIES, docMoney, type CatalogueItem, type TaxRate } from "@/lib/admin/invoice-types";
import {
  deleteCatalogueItem,
  saveCatalogueItem,
  setCatalogueItemActive,
  type CatalogueInput,
} from "@/app/admin/actions/billing";

type Filter = "active" | "hidden";

const blank = (currency: string, taxRates: TaxRate[]): CatalogueInput => ({
  name: "",
  details: "",
  kind: "service",
  code: "",
  unit: "",
  unit_price: "",
  currency,
  prices: {},
  tax_rate_ids: taxRates.filter((r) => r.active && r.is_default).map((r) => r.id),
  active: true,
});

/**
 * Products and services the team bills again and again. Picking one in the
 * invoice editor fills a line (description, details, rate in the document's
 * currency, taxes); the line keeps its own copy.
 */
export default function CatalogueScreen({
  items,
  taxRates,
  baseCurrency,
}: {
  items: CatalogueItem[];
  taxRates: TaxRate[];
  baseCurrency: string;
}) {
  const { run, pending, toast } = useAction();
  const [filter, setFilter] = useState<Filter>("active");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<{ id: string | null; value: CatalogueInput } | null>(null);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items
      .filter((i) => (filter === "active" ? i.active : !i.active))
      .filter((i) => !term || [i.name, i.code, i.details, i.unit].some((x) => x?.toLowerCase().includes(term)));
  }, [items, filter, q]);
  const hidden = items.filter((i) => !i.active).length;

  const open = (item: CatalogueItem | null) =>
    setEditing(
      item
        ? {
            id: item.id,
            value: {
              name: item.name,
              details: item.details ?? "",
              kind: item.kind,
              code: item.code ?? "",
              unit: item.unit ?? "",
              unit_price: item.unit_price,
              currency: item.currency,
              prices: { ...(item.prices ?? {}) },
              tax_rate_ids: item.tax_rate_ids ?? [],
              active: item.active,
            },
          }
        : { id: null, value: blank(baseCurrency, taxRates) },
    );

  const taxNames = (ids: string[] | null) =>
    (ids ?? [])
      .map((id) => taxRates.find((r) => r.id === id))
      .filter((r): r is TaxRate => !!r)
      .map((r) => `${r.name} ${r.rate}%`)
      .join(" · ");

  return (
    <>
      <Panel
        title="Products & services"
        hint="Saved lines for quotes and invoices."
        bodyClass="p-0"
        right={
          <Button variant="primary" onClick={() => open(null)} className="min-h-9">
            <Icon.plus size={13} /> Add
          </Button>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cream/[0.07] px-4 py-3">
          <Tabs
            value={filter}
            onChange={setFilter}
            size="xs"
            options={[
              { value: "active", label: "In use", count: items.length - hidden },
              { value: "hidden", label: "Hidden", count: hidden },
            ]}
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            aria-label="Search the catalogue"
            className="max-w-[220px]"
          />
        </div>
        {shown.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={items.length === 0 ? "Nothing saved yet" : "Nothing here"}
              hint={
                items.length === 0
                  ? "Add the services and products you bill often — a day of design, a monthly retainer, hosting."
                  : "Try another search or tab."
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-cream/[0.06]">
            {shown.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3">
                <button type="button" onClick={() => open(i)} className="min-w-0 flex-1 text-left">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13px] text-cream">{i.name}</span>
                    {i.code && <span className="font-mono text-[10.5px] text-sand">{i.code}</span>}
                    <Badge tone={i.kind === "product" ? "cream" : "muted"}>{i.kind === "product" ? "Product" : "Service"}</Badge>
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-sand">
                    {[i.unit && `per ${i.unit}`, taxNames(i.tax_rate_ids) || "No tax", i.details].filter(Boolean).join(" · ")}
                  </span>
                </button>
                <span className="text-right font-mono text-[12.5px] text-cream tabular-nums">
                  {docMoney(i.unit_price, i.currency)}
                  {Object.keys(i.prices ?? {}).length > 0 && (
                    <span className="block text-[10.5px] text-sand">
                      {Object.entries(i.prices ?? {})
                        .map(([c, v]) => docMoney(Number(v), c))
                        .join(" · ")}
                    </span>
                  )}
                </span>
                <Button
                  variant="quiet"
                  disabled={pending}
                  onClick={() => run(() => setCatalogueItemActive(i.id, !i.active))}
                  className="min-h-9"
                >
                  {i.active ? "Hide" : "Show"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Edit item" : "Add to the catalogue"}
        hint="Documents already made keep their own lines."
        width="max-w-xl"
      >
        {editing && (
          <ItemForm
            value={editing.value}
            onChange={(value) => setEditing((e) => (e ? { ...e, value } : e))}
            taxRates={taxRates}
          />
        )}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-cream/[0.08] pt-3">
          {editing?.id ? (
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() => {
                if (editing.id && window.confirm(`Remove ${editing.value.name} from the catalogue?`)) {
                  run(() => deleteCatalogueItem(editing.id!), { onDone: (r) => r.ok && setEditing(null) });
                }
              }}
              className="min-h-9"
            >
              <Icon.trash size={13} /> Remove
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button onClick={() => setEditing(null)} className="min-h-9">
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={pending || !editing?.value.name.trim()}
              onClick={() => editing && run(() => saveCatalogueItem(editing.id, editing.value), { onDone: (r) => r.ok && setEditing(null) })}
              className="min-h-9"
            >
              Save
            </Button>
          </span>
        </div>
      </Modal>
      {toast}
    </>
  );
}

function ItemForm({
  value,
  onChange,
  taxRates,
}: {
  value: CatalogueInput;
  onChange: (v: CatalogueInput) => void;
  taxRates: TaxRate[];
}) {
  const set = <K extends keyof CatalogueInput>(k: K, v: CatalogueInput[K]) => onChange({ ...value, [k]: v });
  const others = CURRENCIES.filter((c) => c !== value.currency);
  return (
    <div className="space-y-3">
      <Field label="Name" hint="Becomes the line's description.">
        <Input value={value.name} onChange={(e) => set("name", e.target.value)} maxLength={200} autoFocus />
      </Field>
      <Field label="Details" hint="Optional — scope or what's included.">
        <Textarea rows={2} value={value.details ?? ""} onChange={(e) => set("details", e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Type">
          <Select value={value.kind} onChange={(e) => set("kind", e.target.value as CatalogueInput["kind"])}>
            <option value="service" className="bg-ink text-cream">
              Service
            </option>
            <option value="product" className="bg-ink text-cream">
              Product
            </option>
          </Select>
        </Field>
        <Field label="Code">
          <Input value={value.code ?? ""} onChange={(e) => set("code", e.target.value)} maxLength={40} placeholder="WEB-01" />
        </Field>
        <Field label="Unit">
          <Input value={value.unit ?? ""} onChange={(e) => set("unit", e.target.value)} maxLength={20} placeholder="hour" />
        </Field>
        <Field label="Currency">
          <Select value={value.currency} onChange={(e) => set("currency", e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c} className="bg-ink text-cream">
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={`Price (${value.currency})`}>
        <Input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={value.unit_price}
          onChange={(e) => set("unit_price", e.target.value)}
          className="font-mono"
        />
      </Field>
      <details className="border border-cream/[0.08] px-3 py-2">
        <summary className="cursor-pointer text-[12px] text-sand">Prices in other currencies</summary>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {others.map((c) => (
            <Field key={c} label={c}>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={String(value.prices[c] ?? "")}
                onChange={(e) => set("prices", { ...value.prices, [c]: e.target.value })}
                className="font-mono"
              />
            </Field>
          ))}
        </div>
      </details>
      {taxRates.length > 0 && (
        <div>
          <span className="mb-1.5 block text-[10px] uppercase tracking-[0.18em] text-sand">Taxes on a new line</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {taxRates
              .filter((r) => r.active || value.tax_rate_ids.includes(r.id))
              .map((r) => (
                <label key={r.id} className="flex min-h-9 cursor-pointer items-center gap-1.5 text-[12px] text-cream-2">
                  <input
                    type="checkbox"
                    checked={value.tax_rate_ids.includes(r.id)}
                    onChange={(e) =>
                      set("tax_rate_ids", e.target.checked ? [...value.tax_rate_ids, r.id] : value.tax_rate_ids.filter((x) => x !== r.id))
                    }
                    className="h-4 w-4 accent-terra"
                  />
                  {r.name} {r.rate}%
                </label>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
