"use client";

import { useState } from "react";
import Modal from "@/components/admin/Modal";
import { Icon } from "@/components/admin/icons";
import { useAction } from "@/components/admin/useAction";
import { Button, Field, Input, Select, Textarea } from "@/components/admin/ui";
import { CURRENCIES, type InvoiceSettings } from "@/lib/admin/invoice-types";
import { saveInvoiceSettings } from "@/app/admin/actions/invoices";

/**
 * The gear next to the Invoices tabs (admins only — the bank details print on
 * every invoice, so members can read them but not change them).
 */
export default function SettingsButton({ settings }: { settings: InvoiceSettings }) {
  const { run, pending, toast } = useAction();
  const [open, setOpen] = useState(false);
  const s = settings;

  return (
    <>
      <Button onClick={() => setOpen(true)} aria-label="Invoice settings" className="min-h-9">
        <Icon.settings size={14} /> <span className="hidden sm:inline">Settings</span>
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Invoice settings"
        hint="What every new invoice and quote starts with. Changes don't touch documents already issued."
        width="max-w-2xl"
      >
        <form
          action={(fd) => run(() => saveInvoiceSettings(fd), { onDone: (r) => r.ok && setOpen(false) })}
          className="space-y-5"
        >
          <section className="space-y-3">
            <p className="eyebrow text-[9.5px]">Business</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Business name">
                <Input name="business_name" required defaultValue={s.business_name} />
              </Field>
              <Field label="Tax ID" hint="Prints under your address. Optional.">
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
          </section>

          <section className="space-y-3 border-t border-cream/[0.08] pt-4">
            <p className="eyebrow text-[9.5px]">Defaults</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Field label="Currency">
                <Select name="default_currency" defaultValue={s.default_currency}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c} className="bg-ink text-cream">
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tax label">
                <Input name="tax_label" defaultValue={s.tax_label} placeholder="VAT" />
              </Field>
              <Field label="Tax rate %">
                <Input name="default_tax_rate" type="number" min="0" max="100" step="0.01" defaultValue={s.default_tax_rate} />
              </Field>
              <Field label="Due in (days)">
                <Input name="default_due_days" type="number" min="0" max="365" step="1" defaultValue={s.default_due_days} />
              </Field>
              <Field label="Invoice prefix" hint={`Next: ${s.invoice_prefix}-${String(s.next_invoice_number).padStart(4, "0")}`} className="sm:col-span-2">
                <Input name="invoice_prefix" defaultValue={s.invoice_prefix} maxLength={8} />
              </Field>
              <Field label="Quote prefix" hint={`Next: ${s.quote_prefix}-${String(s.next_quote_number).padStart(4, "0")}`} className="sm:col-span-2">
                <Input name="quote_prefix" defaultValue={s.quote_prefix} maxLength={8} />
              </Field>
            </div>
          </section>

          <section className="space-y-3 border-t border-cream/[0.08] pt-4">
            <p className="eyebrow text-[9.5px]">On the paper</p>
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
          </section>

          <div className="flex items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              Save settings
            </Button>
          </div>
        </form>
      </Modal>
      {toast}
    </>
  );
}
