"use client";

import { useMemo, useState } from "react";
import Modal from "@/components/admin/Modal";
import { Icon } from "@/components/admin/icons";
import { Tabs } from "@/components/admin/Tabs";
import { useAction } from "@/components/admin/useAction";
import { Badge, Button, EmptyState, Field, Input, Notice, Panel, Textarea } from "@/components/admin/ui";
import { moneyShort } from "@/lib/admin/format";
import type { Supplier } from "@/lib/admin/bills";
import { EXPENSE_CATEGORIES } from "@/lib/admin/types";
import { deleteSupplier, saveSupplier, setSupplierActive, type SupplierInput } from "@/app/admin/actions/bills";

export type SupplierTotals = { billed: number; owed: number; bills: number };

const blank: SupplierInput = { name: "", contact_name: "", email: "", phone: "", address: "", tax_id: "", default_category: "", notes: "" };

export default function SuppliersScreen({
  ready,
  suppliers,
  totals,
}: {
  ready: boolean;
  suppliers: Supplier[];
  totals: Record<string, SupplierTotals>;
}) {
  const { run, pending, toast } = useAction();
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<{ id: string | null; value: SupplierInput; active?: boolean } | null>(null);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return suppliers
      .filter((s) => (filter === "active" ? s.active : !s.active))
      .filter((s) => !term || [s.name, s.contact_name, s.email, s.tax_id].some((x) => x?.toLowerCase().includes(term)));
  }, [suppliers, filter, q]);

  if (!ready) {
    return (
      <Notice tone="warn" title="Suppliers aren't set up yet">
        They arrive with the suppliers &amp; bills migration (0040).
      </Notice>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={filter}
          onChange={setFilter}
          options={[
            { value: "active", label: "Active", count: suppliers.filter((s) => s.active).length },
            { value: "archived", label: "Archived", count: suppliers.filter((s) => !s.active).length },
          ]}
        />
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search suppliers" className="sm:w-56" />
          <Button variant="primary" onClick={() => setEditing({ id: null, value: blank })} className="min-h-9" data-shortcut="new">
            <Icon.plus size={13} /> Add supplier
          </Button>
        </div>
      </div>
      <Panel bodyClass="p-0">
        {shown.length === 0 ? (
          <div className="p-4">
            <EmptyState title={suppliers.length ? "Nothing here" : "No suppliers yet"} hint="Landlords, software, contractors — whoever sends you bills." />
          </div>
        ) : (
          <ul>
            {shown.map((s) => {
              const t = totals[s.id];
              return (
                <li key={s.id} className="border-b border-cream/[0.05] last:border-0">
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({
                        id: s.id,
                        active: s.active,
                        value: {
                          name: s.name,
                          contact_name: s.contact_name ?? "",
                          email: s.email ?? "",
                          phone: s.phone ?? "",
                          address: s.address ?? "",
                          tax_id: s.tax_id ?? "",
                          default_category: s.default_category ?? "",
                          notes: s.notes ?? "",
                        },
                      })
                    }
                    className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-cream/[0.03]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-cream">{s.name}</span>
                      <span className="block truncate text-[11.5px] text-sand">
                        {[s.contact_name, s.email, s.default_category, s.tax_id && `TIN ${s.tax_id}`].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    {t && (
                      <span className="text-right text-[11.5px] text-sand">
                        <span className="block font-mono text-[12.5px] tabular-nums text-cream">{moneyShort(t.owed)} owed</span>
                        {t.bills} bill{t.bills === 1 ? "" : "s"} · {moneyShort(t.billed)} billed
                      </span>
                    )}
                    {!s.active && <Badge tone="muted">Archived</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? editing.value.name || "Supplier" : "Add a supplier"} width="max-w-xl">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" className="sm:col-span-2">
              <Input value={editing.value.name} onChange={(e) => setEditing({ ...editing, value: { ...editing.value, name: e.target.value } })} autoFocus />
            </Field>
            {(
              [
                ["contact_name", "Contact"],
                ["email", "Email"],
                ["phone", "Phone"],
                ["tax_id", "TIN / VAT number"],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label}>
                <Input value={editing.value[k] ?? ""} onChange={(e) => setEditing({ ...editing, value: { ...editing.value, [k]: e.target.value } })} />
              </Field>
            ))}
            <Field label="Usual category" hint="Their bills start with it." className="sm:col-span-2">
              <Input
                value={editing.value.default_category ?? ""}
                onChange={(e) => setEditing({ ...editing, value: { ...editing.value, default_category: e.target.value } })}
                list="supplier-categories"
              />
              <datalist id="supplier-categories">
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Textarea rows={2} value={editing.value.address ?? ""} onChange={(e) => setEditing({ ...editing, value: { ...editing.value, address: e.target.value } })} />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea rows={2} value={editing.value.notes ?? ""} onChange={(e) => setEditing({ ...editing, value: { ...editing.value, notes: e.target.value } })} />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-cream/[0.08] pt-3">
            <span className="flex gap-1.5">
              {editing.id && (
                <Button variant="quiet" disabled={pending} onClick={() => run(() => setSupplierActive(editing.id!, !editing.active), { onDone: (r) => r.ok && setEditing(null) })} className="min-h-9">
                  {editing.active ? "Archive" : "Restore"}
                </Button>
              )}
              {editing.id && !totals[editing.id] && (
                <Button variant="quiet" disabled={pending} onClick={() => confirm("Delete this supplier?") && run(() => deleteSupplier(editing.id!), { onDone: (r) => r.ok && setEditing(null) })} className="min-h-9">
                  <Icon.trash size={13} /> Delete
                </Button>
              )}
            </span>
            <Button variant="primary" disabled={pending || !editing.value.name.trim()} onClick={() => run(() => saveSupplier(editing.id, editing.value), { onDone: (r) => r.ok && setEditing(null) })} className="min-h-9">
              Save
            </Button>
          </div>
        </Modal>
      )}
      {toast}
    </>
  );
}
