"use client";

import { useState } from "react";
import { useAction } from "@/components/admin/useAction";
import { Badge, Button, Checkbox, Notice, Panel } from "@/components/admin/ui";
import type { InvoiceSettings } from "@/lib/admin/invoice-types";
import { savePaymentSettings, type PaymentSettingsInput } from "@/app/admin/actions/billing";

/**
 * Online payment (0039): the switch, which providers, and whether their keys
 * are on the website. `keys` is null where that can't be known (the desktop
 * app — the keys live only on the website's server).
 */
export default function PaymentSettings({
  settings: s,
  keys,
}: {
  settings: InvoiceSettings;
  keys: { payhere: boolean; stripe: boolean; jobs: boolean } | null;
}) {
  const { run, pending, toast } = useAction();
  const [form, setForm] = useState<PaymentSettingsInput>({
    online_payments: !!s.online_payments,
    payhere_enabled: !!s.payhere_enabled,
    stripe_enabled: !!s.stripe_enabled,
  });
  const status = (ready: boolean | undefined) =>
    keys === null ? <Badge tone="muted">Set on the website</Badge> : ready ? <Badge tone="success">Keys set</Badge> : <Badge tone="warn">No keys yet</Badge>;

  return (
    <div className="grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Panel title="Pay online" hint="A link on each open invoice, its email and its reminders, to a payment page on the website.">
        <div className="space-y-4">
          <Checkbox
            checked={form.online_payments}
            onChange={(e) => setForm((f) => ({ ...f, online_payments: e.target.checked }))}
            label="Let clients pay invoices online"
            hint="Payments come in through the provider and are recorded on the invoice — and in Income — once the provider confirms them."
          />
          <div className="space-y-3 border-t border-cream/[0.08] pt-3">
            <div className="flex items-start justify-between gap-3">
              <Checkbox
                checked={form.payhere_enabled}
                disabled={!form.online_payments}
                onChange={(e) => setForm((f) => ({ ...f, payhere_enabled: e.target.checked }))}
                label="PayHere"
                hint="Rupees (and USD, GBP, EUR, AUD). Cards, bank apps and eZ Cash in Sri Lanka."
              />
              {status(keys?.payhere)}
            </div>
            <div className="flex items-start justify-between gap-3">
              <Checkbox
                checked={form.stripe_enabled}
                disabled={!form.online_payments}
                onChange={(e) => setForm((f) => ({ ...f, stripe_enabled: e.target.checked }))}
                label="Stripe"
                hint="Card payments in other currencies. Needs a Stripe account in a country Stripe supports."
              />
              {status(keys?.stripe)}
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" disabled={pending} onClick={() => run(() => savePaymentSettings(form))} className="min-h-9">
              Save payments
            </Button>
          </div>
        </div>
      </Panel>
      <div className="space-y-4">
        <Notice tone="info" title="Keys go on the website, not here">
          In Netlify&apos;s environment variables: PAYHERE_MERCHANT_ID and PAYHERE_MERCHANT_SECRET (a secret made for this
          site&apos;s domain in PayHere › Integrations), and for Stripe STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET (webhook to
          /api/pay/stripe, event checkout.session.completed). PAYHERE_SANDBOX=1 tests against PayHere&apos;s sandbox.
        </Notice>
        <Notice tone="warn" title="Foreign-currency invoices need a rate">
          A payment in another currency is recorded in rupees at the invoice&apos;s exchange rate — set it on the invoice
          before sending the link.
        </Notice>
      </div>
      {toast}
    </div>
  );
}
