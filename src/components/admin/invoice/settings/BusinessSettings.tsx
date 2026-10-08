"use client";

import { useAction } from "@/components/admin/useAction";
import { Button, Checkbox, Field, Input, Panel, Select, Textarea } from "@/components/admin/ui";
import { CURRENCIES, type InvoiceSettings } from "@/lib/admin/invoice-types";
import { saveInvoiceSettings } from "@/app/admin/actions/invoices";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The business block, defaults and tax status — what every new document starts with. */
export default function BusinessSettings({ settings: s }: { settings: InvoiceSettings }) {
  const { run, pending, toast } = useAction();
  return (
    <form action={(fd) => run(() => saveInvoiceSettings(fd))} className="grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-2">
      <Panel title="Business" hint="Prints in the From block of every document.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Business name">
            <Input name="business_name" required defaultValue={s.business_name} />
          </Field>
          <Field label="TIN / VAT number" hint="Your tax number. Optional unless you're VAT-registered.">
            <Input name="tax_id" defaultValue={s.tax_id ?? ""} />
          </Field>
          <Field label="Email">
            <Input name="business_email" type="email" defaultValue={s.business_email ?? ""} />
          </Field>
          <Field label="Phone">
            <Input name="business_phone" defaultValue={s.business_phone ?? ""} />
          </Field>
          <Field label="Website">
            <Input name="business_website" defaultValue={s.business_website ?? ""} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Textarea name="business_address" rows={2} defaultValue={s.business_address ?? ""} />
          </Field>
        </div>
      </Panel>

      <div className="space-y-5">
        <Panel title="Defaults" hint="New documents start with these. Changes never touch documents already made.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Currency">
              <Select name="default_currency" defaultValue={s.default_currency}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c} className="bg-ink text-cream">
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Due in (days)">
              <Input name="default_due_days" type="number" min="0" max="365" step="1" defaultValue={s.default_due_days} />
            </Field>
            <Field label="Tax year starts">
              <Select name="fiscal_year_start_month" defaultValue={String(s.fiscal_year_start_month ?? 4)}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1} className="bg-ink text-cream">
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Panel>

        <Panel title="Tax" hint="Rates live under Taxes; this is how documents present them.">
          <div className="space-y-3">
            <Checkbox
              name="tax_registered"
              defaultChecked={!!s.tax_registered}
              label="We're VAT-registered"
              hint="Taxed invoices print as TAX INVOICE with both TINs, the date of supply and, for foreign currency, the rupee values — Sri Lanka's tax-invoice rules from 1 July 2026."
            />
            <Checkbox
              name="prices_include_tax"
              defaultChecked={!!s.prices_include_tax}
              label="Prices include tax by default"
              hint="New documents start with tax-inclusive line prices. Each document can still switch."
            />
          </div>
        </Panel>
      </div>

      <Panel title="On the paper" hint="Printed on every new document; editable on each one." className="lg:col-span-2">
        <div className="space-y-3">
          <Field label="Payment details" hint="Bank, branch, account name and number — prints on a tinted panel.">
            <Textarea name="payment_details" rows={4} defaultValue={s.payment_details ?? ""} className="font-mono" />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Default notes">
              <Textarea name="default_notes" rows={3} defaultValue={s.default_notes ?? ""} />
            </Field>
            <Field label="Default terms">
              <Textarea name="default_terms" rows={3} defaultValue={s.default_terms ?? ""} />
            </Field>
          </div>
        </div>
      </Panel>

      <div className="flex justify-end lg:col-span-2">
        <Button type="submit" variant="primary" disabled={pending} className="min-h-9">
          Save business settings
        </Button>
      </div>
      {toast}
    </form>
  );
}
