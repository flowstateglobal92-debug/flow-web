/**
 * The wording of document emails — invoices, quotes, credit notes,
 * statements and payment reminders. Each has a built-in subject and message
 * that a workspace can replace (invoice_settings.email_*, 0036/0038), with
 * {placeholders} filled in when sending:
 *
 *   {client} {first_name} {number} {amount} {balance} {due_date}
 *   {valid_until} {days_overdue} {credited_number} {business} {sender} {pay_link}
 *
 * A {pay_link} line is dropped when there's no link (online payment off).
 */

export type MailKind = "invoice" | "quote" | "credit_note" | "statement" | "reminder";

export const PLACEHOLDERS: { token: string; label: string }[] = [
  { token: "{first_name}", label: "Client's first name" },
  { token: "{client}", label: "Client's name" },
  { token: "{number}", label: "Document number" },
  { token: "{amount}", label: "Total" },
  { token: "{balance}", label: "Left to pay" },
  { token: "{due_date}", label: "Due date" },
  { token: "{business}", label: "Your business name" },
  { token: "{sender}", label: "Who's sending" },
  { token: "{pay_link}", label: "Pay-online link" },
];

export const DEFAULT_SUBJECT: Record<MailKind, string> = {
  invoice: "Invoice {number} from {business}",
  quote: "Quotation {number} from {business}",
  credit_note: "Credit note {number} from {business}",
  statement: "Statement of account from {business}",
  reminder: "Reminder: invoice {number} is overdue",
};

export const DEFAULT_BODY: Record<MailKind, string> = {
  invoice: [
    "Hi {first_name},",
    "",
    "Please find attached invoice {number} for {amount}, due {due_date}.",
    "Pay online: {pay_link}",
    "",
    "Thank you,",
    "{sender}",
    "{business}",
  ].join("\n"),
  quote: [
    "Hi {first_name},",
    "",
    "Please find attached our quotation {number} for {amount}, valid until {valid_until}.",
    "",
    "Let us know if you have any questions.",
    "",
    "{sender}",
    "{business}",
  ].join("\n"),
  credit_note: [
    "Hi {first_name},",
    "",
    "Please find attached credit note {number} for {amount}, against invoice {credited_number}.",
    "",
    "{sender}",
    "{business}",
  ].join("\n"),
  statement: [
    "Hi {first_name},",
    "",
    "Please find attached your statement of account. The balance outstanding is {balance}.",
    "",
    "Thank you,",
    "{sender}",
    "{business}",
  ].join("\n"),
  reminder: [
    "Hi {first_name},",
    "",
    "A friendly reminder that invoice {number} for {amount} was due on {due_date} — {days_overdue} days ago. {balance} is still outstanding.",
    "Pay online: {pay_link}",
    "",
    "If you've already paid, thank you, and please ignore this message.",
    "",
    "{business}",
  ].join("\n"),
};

export type MailVars = Partial<
  Record<
    | "client"
    | "first_name"
    | "number"
    | "amount"
    | "balance"
    | "due_date"
    | "valid_until"
    | "days_overdue"
    | "credited_number"
    | "business"
    | "sender"
    | "pay_link",
    string | null
  >
>;

/** The first word of a name, for "Hi Nadeesha". */
export const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "there";

/**
 * Fill a template. A line whose only placeholder is missing goes (so "Pay
 * online: {pay_link}" disappears when there's no link); other missing ones
 * become empty.
 */
export function fillTemplate(template: string, vars: MailVars) {
  return template
    .split("\n")
    .filter((line) => {
      const tokens = [...line.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
      return !(tokens.includes("pay_link") && !vars.pay_link);
    })
    .map((line) => line.replace(/\{([a-z_]+)\}/g, (_, k: string) => vars[k as keyof MailVars] ?? ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
