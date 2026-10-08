"use client";

import { useState } from "react";
import { useAction } from "@/components/admin/useAction";
import { Button, Field, Input, Notice, Panel, Select } from "@/components/admin/ui";
import type { InvoiceSettings } from "@/lib/admin/invoice-types";
import {
  NUMBER_PRESETS,
  NUMBER_RESETS,
  NUMBER_TOKENS,
  checkNumberFormat,
  formatDocumentNumber,
  slSerialWarning,
  type NumberReset,
  type NumberedKind,
} from "@/lib/admin/numbering";
import { saveNumbering, setNextNumber } from "@/app/admin/actions/billing";

type Kind = { key: NumberedKind; label: string; prefix: keyof InvoiceSettings; format: keyof InvoiceSettings; fallback: string };

const KINDS: Kind[] = [
  { key: "invoice", label: "Invoices", prefix: "invoice_prefix", format: "invoice_number_format", fallback: "INV" },
  { key: "quote", label: "Quotes", prefix: "quote_prefix", format: "quote_number_format", fallback: "QT" },
  { key: "credit_note", label: "Credit notes", prefix: "credit_note_prefix", format: "credit_note_number_format", fallback: "CN" },
];

/**
 * How documents are numbered: a prefix and a pattern per kind, when the count
 * starts again, and the next number. The preview is the browser's copy of the
 * database's formatter; "Next" is what the database will actually issue.
 */
export default function NumberingSettings({
  settings,
  next,
  today,
}: {
  settings: InvoiceSettings;
  next: Record<NumberedKind, string | null> | null;
  today: string;
}) {
  const { run, pending, toast } = useAction();
  const [form, setForm] = useState(() => ({
    reset: (settings.number_reset ?? "never") as NumberReset,
    ...Object.fromEntries(
      KINDS.flatMap((k) => [
        [k.prefix, String(settings[k.prefix] ?? k.fallback)],
        [k.format, String(settings[k.format] ?? "{PREFIX}-{SEQ:4}")],
      ]),
    ),
  }) as Record<string, string> & { reset: NumberReset });
  const [focus, setFocus] = useState<NumberedKind>("invoice");
  const fy = settings.fiscal_year_start_month ?? 4;

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const insert = (token: string) => {
    const k = KINDS.find((x) => x.key === focus)!;
    set(String(k.format), `${form[String(k.format)]}${token}`);
  };

  return (
    <form
      action={(fd) => run(() => saveNumbering(fd))}
      className="grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
    >
      <Panel title="Patterns" hint="Prefix and pattern per kind. Documents already issued keep their numbers.">
        <div className="space-y-4">
          {KINDS.map((k) => {
            const fmt = form[String(k.format)];
            const problem = checkNumberFormat(fmt);
            const sample = problem ? null : formatDocumentNumber(fmt, form[String(k.prefix)] || k.fallback, 1, today, fy);
            const sl = k.key === "invoice" && sample ? slSerialWarning(sample) : null;
            return (
              <div key={k.key} className="grid grid-cols-1 gap-3 border-b border-cream/[0.06] pb-4 last:border-0 last:pb-0 sm:grid-cols-[110px_minmax(0,1fr)]">
                <Field label={`${k.label} prefix`}>
                  <Input
                    name={String(k.prefix)}
                    value={form[String(k.prefix)]}
                    onChange={(e) => set(String(k.prefix), e.target.value.toUpperCase())}
                    maxLength={8}
                  />
                </Field>
                <Field
                  label="Pattern"
                  hint={problem ?? (sl ? `${sample} — ${sl}` : `Looks like ${sample}`)}
                >
                  <Input
                    name={String(k.format)}
                    value={fmt}
                    onFocus={() => setFocus(k.key)}
                    onChange={(e) => set(String(k.format), e.target.value)}
                    maxLength={60}
                    className={`font-mono ${problem ? "border-bad-400/50" : ""}`}
                  />
                </Field>
              </div>
            );
          })}

          <div>
            <p className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-sand">
              Add to the {KINDS.find((k) => k.key === focus)!.label.toLowerCase()} pattern
            </p>
            <div className="flex flex-wrap gap-1.5">
              {NUMBER_TOKENS.map((t) => (
                <button
                  key={t.token}
                  type="button"
                  onClick={() => insert(t.token)}
                  title={t.label}
                  className="min-h-8 border border-cream/12 bg-cream/[0.03] px-2 font-mono text-[11px] text-cream-2 transition-colors hover:border-cream/30 hover:text-cream"
                >
                  {t.token}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {NUMBER_PRESETS.map((p) => (
                <button
                  key={p.format}
                  type="button"
                  onClick={() => set(String(KINDS.find((k) => k.key === focus)!.format), p.format)}
                  className="min-h-8 border border-dashed border-cream/15 px-2.5 text-[11.5px] text-sand transition-colors hover:border-cream/30 hover:text-cream"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <Field label="Start again at 1" hint={NUMBER_RESETS.find((r) => r.value === form.reset)?.hint}>
            <Select name="number_reset" value={form.reset} onChange={(e) => set("reset", e.target.value)}>
              {NUMBER_RESETS.map((r) => (
                <option key={r.value} value={r.value} className="bg-ink text-cream">
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={pending} className="min-h-9">
              Save numbering
            </Button>
          </div>
        </div>
      </Panel>

      <div className="space-y-5">
        <Panel title="Next numbers" hint="What the database will issue next, today. Change the running number if you're moving from another system.">
          <ul className="space-y-3">
            {KINDS.map((k) => (
              <NextNumber key={k.key} kind={k} next={next?.[k.key] ?? null} run={run} pending={pending} />
            ))}
          </ul>
        </Panel>
        <Notice tone="info" title="Sri Lankan tax invoices">
          From 1 July 2026 a VAT-registered business&apos;s tax invoice serial follows YYMMM_CODE_NUMBER (for example
          26JUL_BR03_1), runs on without restarting, has no spaces and is 40 characters at most. Pick the preset and swap
          BR03 for your own branch code.
        </Notice>
      </div>
      {toast}
    </form>
  );
}

function NextNumber({
  kind,
  next,
  run,
  pending,
}: {
  kind: Kind;
  next: string | null;
  run: ReturnType<typeof useAction>["run"];
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[12px] text-sand">{kind.label}</p>
        <p className="font-mono text-[13px] text-cream tabular-nums">{next ?? "—"}</p>
      </div>
      {editing ? (
        <span className="flex items-center gap-1.5">
          <Input
            type="number"
            min="1"
            step="1"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Running no."
            aria-label={`Next ${kind.label.toLowerCase()} running number`}
            className="w-28 font-mono"
          />
          <Button
            type="button"
            disabled={pending || !(Number(value) >= 1)}
            onClick={() => run(() => setNextNumber(kind.key, Number(value)), { onDone: (r) => r.ok && setEditing(false) })}
            className="min-h-9"
          >
            Set
          </Button>
        </span>
      ) : (
        <Button type="button" onClick={() => setEditing(true)} className="min-h-9">
          Change
        </Button>
      )}
    </li>
  );
}
