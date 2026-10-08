"use client";

import { useState } from "react";
import { Icon } from "@/components/admin/icons";
import { useAction } from "@/components/admin/useAction";
import { Button, EmptyState, Input, Notice, Panel } from "@/components/admin/ui";
import type { TaxRate } from "@/lib/admin/invoice-types";
import { deleteTaxRate, saveTaxRate, type TaxRateInput } from "@/app/admin/actions/billing";

const PRESETS: TaxRateInput[] = [
  { name: "VAT", rate: 18, compound: false, is_default: true, active: true },
  { name: "SSCL", rate: 2.5, compound: false, is_default: false, active: true },
];

const blank = (): TaxRateInput => ({ name: "", rate: "", compound: false, is_default: false, active: true, note: "" });

/**
 * The workspace's tax rates. Each line of a document carries the ones picked
 * for it — a copy, so editing a rate here never changes a document already
 * made. "Default" rates go on new lines; "on other taxes" (compound) is
 * charged on the line plus its other taxes.
 */
export default function TaxSettings({ rates, registered }: { rates: TaxRate[]; registered: boolean }) {
  const { run, pending, toast } = useAction();
  const [draft, setDraft] = useState<TaxRateInput>(blank);
  const missing = PRESETS.filter((p) => !rates.some((r) => r.name.toLowerCase() === p.name.toLowerCase()));

  return (
    <div className="grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Panel
        title="Tax rates"
        hint="What a document line can carry."
        bodyClass="p-0"
        right={<span className="font-mono text-[11px] text-sand tabular-nums">{rates.length}</span>}
      >
        {rates.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No tax rates yet" hint="Documents carry no tax until you add one. Start from a preset below or add your own." />
          </div>
        ) : (
          <ul className="divide-y divide-cream/[0.06]">
            {rates.map((r) => (
              <RateRow key={r.id} rate={r} run={run} pending={pending} />
            ))}
          </ul>
        )}

        <div className="space-y-3 border-t border-cream/[0.08] p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-sand">Add a rate</p>
          {missing.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {missing.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setDraft({ ...p, note: "" })}
                  className="min-h-8 border border-dashed border-cream/15 px-2.5 text-[11.5px] text-sand transition-colors hover:border-cream/30 hover:text-cream"
                >
                  {p.name} {p.rate}%
                </button>
              ))}
            </div>
          )}
          <RateFields value={draft} onChange={setDraft} />
          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={pending || !draft.name.trim() || String(draft.rate).trim() === ""}
              onClick={() => run(() => saveTaxRate(null, draft), { onDone: (res) => res.ok && setDraft(blank()) })}
              className="min-h-9"
            >
              <Icon.plus size={13} /> Add rate
            </Button>
          </div>
        </div>
      </Panel>

      <div className="space-y-4">
        <Notice tone="info" title="Check the rates with your accountant">
          Sri Lanka&apos;s standard VAT is 18% and SSCL is 2.5% of liable turnover. Whether VAT is charged on the amount
          including SSCL (tick &ldquo;on other taxes&rdquo; on VAT) depends on how you pass SSCL on — confirm it before you
          issue tax invoices.
        </Notice>
        {!registered && (
          <Notice tone="warn" title="Not set as VAT-registered">
            Documents with tax print as plain invoices. Tick &ldquo;We&apos;re VAT-registered&rdquo; under Business when
            they should be tax invoices.
          </Notice>
        )}
      </div>
      {toast}
    </div>
  );
}

function RateFields({ value, onChange }: { value: TaxRateInput; onChange: (v: TaxRateInput) => void }) {
  const set = <K extends keyof TaxRateInput>(k: K, v: TaxRateInput[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] gap-2 sm:grid-cols-[minmax(0,1.2fr)_110px_minmax(0,1.6fr)]">
      <Input value={value.name} onChange={(e) => set("name", e.target.value)} placeholder="VAT" aria-label="Tax name" maxLength={40} />
      <Input
        type="number"
        inputMode="decimal"
        min="0"
        max="100"
        step="0.001"
        value={value.rate}
        onChange={(e) => set("rate", e.target.value)}
        placeholder="18"
        aria-label="Rate %"
        className="font-mono"
      />
      <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 sm:col-span-1">
        <Toggle checked={value.is_default} onChange={(v) => set("is_default", v)} label="Default" title="Goes on new lines" />
        <Toggle checked={value.compound} onChange={(v) => set("compound", v)} label="On other taxes" title="Charged on the line plus its other taxes" />
        <Toggle checked={value.active} onChange={(v) => set("active", v)} label="In use" title="Offered in the editor" />
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label: string; title: string }) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-1.5 text-[11.5px] text-cream-2" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-terra" />
      {label}
    </label>
  );
}

function RateRow({ rate, run, pending }: { rate: TaxRate; run: ReturnType<typeof useAction>["run"]; pending: boolean }) {
  const initial: TaxRateInput = {
    name: rate.name,
    rate: rate.rate,
    compound: rate.compound,
    is_default: rate.is_default,
    active: rate.active,
    note: rate.note ?? "",
  };
  const [value, setValue] = useState<TaxRateInput>(initial);
  const changed = JSON.stringify(value) !== JSON.stringify(initial);
  return (
    <li className={`space-y-2 p-4 ${rate.active ? "" : "opacity-70"}`}>
      <RateFields value={value} onChange={setValue} />
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="quiet"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Remove ${rate.name} ${rate.rate}%? Documents that used it keep it.`)) run(() => deleteTaxRate(rate.id));
          }}
          className="min-h-9"
        >
          <Icon.trash size={13} /> Remove
        </Button>
        <Button disabled={pending || !changed} onClick={() => run(() => saveTaxRate(rate.id, value))} className="min-h-9">
          Save
        </Button>
      </div>
    </li>
  );
}
