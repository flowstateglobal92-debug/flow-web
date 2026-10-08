"use client";

import { useState } from "react";
import { useAction } from "@/components/admin/useAction";
import { Button, Checkbox, Field, Input, Notice, Panel, Textarea } from "@/components/admin/ui";
import { DEFAULT_BODY, DEFAULT_SUBJECT, PLACEHOLDERS, type MailKind } from "@/lib/admin/document-mail";
import type { InvoiceSettings } from "@/lib/admin/invoice-types";
import { saveEmailSettings, type EmailSettingsInput } from "@/app/admin/actions/billing";

type Kind = "invoice" | "quote" | "credit" | "reminder";
const KINDS: { key: Kind; mail: MailKind; label: string }[] = [
  { key: "invoice", mail: "invoice", label: "Invoices" },
  { key: "quote", mail: "quote", label: "Quotes" },
  { key: "credit", mail: "credit_note", label: "Credit notes" },
  { key: "reminder", mail: "reminder", label: "Overdue reminders" },
];

/**
 * The wording documents go out with, and the automatic overdue reminders.
 * Empty fields use the built-in wording (shown as the placeholder).
 */
export default function EmailSettings({ settings: s, jobsReady }: { settings: InvoiceSettings; jobsReady: boolean }) {
  const { run, pending, toast } = useAction();
  const [form, setForm] = useState<EmailSettingsInput>(() => ({
    reminders_enabled: !!s.reminders_enabled,
    reminder_days: (s.reminder_days ?? [3, 7, 14]).join(", "),
    templates: Object.fromEntries(
      KINDS.map((k) => [
        k.key,
        {
          subject: (s[`email_${k.key}_subject` as keyof InvoiceSettings] as string | null) ?? "",
          body: (s[`email_${k.key}_body` as keyof InvoiceSettings] as string | null) ?? "",
        },
      ]),
    ) as EmailSettingsInput["templates"],
  }));
  const [open, setOpen] = useState<Kind>("invoice");
  const setTemplate = (k: Kind, field: "subject" | "body", value: string) =>
    setForm((f) => ({ ...f, templates: { ...f.templates, [k]: { ...f.templates[k], [field]: value } } }));

  return (
    <div className="grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="space-y-5">
        <Panel title="Overdue reminders" hint="Emailed with the invoice attached, between 9am and 6pm.">
          <div className="space-y-3">
            <Checkbox
              checked={form.reminders_enabled}
              onChange={(e) => setForm((f) => ({ ...f, reminders_enabled: e.target.checked }))}
              label="Send reminders automatically"
              hint="To the invoice's email (or the client's). Clients and single invoices can be left out."
            />
            <Field label="Days after the due date" hint="Each one goes once. 3, 7, 14 sends three reminders.">
              <Input
                value={form.reminder_days}
                onChange={(e) => setForm((f) => ({ ...f, reminder_days: e.target.value }))}
                placeholder="3, 7, 14"
                className="font-mono"
              />
            </Field>
            {!jobsReady && (
              <Notice tone="warn" title="The scheduler isn't set up yet">
                Reminders and monthly statements go out from the website&apos;s hourly job, which needs CRON_SECRET in
                Netlify&apos;s environment variables. Until then nothing is sent automatically.
              </Notice>
            )}
          </div>
        </Panel>
        <Panel title="Placeholders" hint="Filled in when the email goes out.">
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {PLACEHOLDERS.map((p) => (
              <li key={p.token} className="text-[12px] text-cream-2">
                <span className="font-mono text-terra-bright">{p.token}</span> <span className="text-sand">{p.label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-[11px] text-sand/80">A line with {"{pay_link}"} is left out when online payment is off.</p>
        </Panel>
      </div>

      <Panel title="Wording" hint="Leave a field empty to use the wording shown in grey.">
        <div className="space-y-2">
          {KINDS.map((k) => (
            <details
              key={k.key}
              open={open === k.key}
              onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && setOpen(k.key)}
              className="border border-cream/[0.08] px-3 py-2"
            >
              <summary className="cursor-pointer text-[12.5px] text-cream">{k.label}</summary>
              <div className="mt-3 space-y-3">
                <Field label="Subject">
                  <Input
                    value={form.templates[k.key].subject}
                    onChange={(e) => setTemplate(k.key, "subject", e.target.value)}
                    placeholder={DEFAULT_SUBJECT[k.mail]}
                    maxLength={200}
                  />
                </Field>
                <Field label="Message">
                  <Textarea
                    rows={9}
                    value={form.templates[k.key].body}
                    onChange={(e) => setTemplate(k.key, "body", e.target.value)}
                    placeholder={DEFAULT_BODY[k.mail]}
                    maxLength={4000}
                  />
                </Field>
              </div>
            </details>
          ))}
          <div className="flex justify-end pt-2">
            <Button variant="primary" disabled={pending} onClick={() => run(() => saveEmailSettings(form))} className="min-h-9">
              Save emails & reminders
            </Button>
          </div>
        </div>
      </Panel>
      {toast}
    </div>
  );
}
