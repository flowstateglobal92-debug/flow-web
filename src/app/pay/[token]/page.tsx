import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate, num } from "@/lib/admin/format";
import { docMoney } from "@/lib/admin/invoice-types";
import { PAYHERE_CURRENCIES, payhereCheckoutUrl, payhereFields, payhereReady, stripeReady } from "@/lib/payments/providers";
import { SITE } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pay an invoice",
  robots: { index: false, follow: false },
};

type Page = {
  invoice_id: string;
  number: string | null;
  status: string;
  currency: string;
  total: number;
  balance_due: number;
  due_date: string | null;
  subject: string | null;
  bill_to_name: string;
  bill_to_company: string | null;
  bill_to_email: string | null;
  bill_to_phone: string | null;
  bill_to_address: string | null;
  business_name: string;
  business_email: string | null;
  payhere: boolean;
  stripe: boolean;
};

/** A fresh PayHere order id per checkout: the invoice number and a stamp. */
const orderId = (number: string | null) => `${number ?? "INV"}-${Date.now().toString(36)}`;

/**
 * The page behind an invoice's pay-online link (0039): what's owed and the
 * ways to pay it. Public — the 32-character token is the key — and shows only
 * what the invoice itself says. The payment is recorded when the provider
 * confirms it to /api/pay/*, never from this page.
 */
export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ token }, { error }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f]{32}$/.test(token)) notFound();
  const { data } = await createAdminClient().rpc("payment_page", { p_token: token });
  const page = data as Page | null;
  if (!page) notFound();

  const balance = num(page.balance_due);
  const settled = balance <= 0 || ["paid", "credited", "written_off", "void"].includes(page.status);
  const money = (v: number) => docMoney(v, page.currency);
  const base = `${SITE.url}/pay/${token}`;
  const canPayHere = page.payhere && payhereReady() && PAYHERE_CURRENCIES.includes(page.currency);
  const canStripe = page.stripe && stripeReady();
  const payhere = canPayHere
    ? payhereFields({
        orderId: orderId(page.number),
        amount: balance,
        currency: page.currency,
        items: `Invoice ${page.number ?? ""}`.trim(),
        token,
        returnUrl: `${base}/done`,
        cancelUrl: base,
        notifyUrl: `${SITE.url}/api/pay/payhere`,
        customer: {
          name: page.bill_to_name,
          email: page.bill_to_email ?? "",
          phone: page.bill_to_phone ?? "",
          address: (page.bill_to_address ?? "").split("\n")[0] ?? "",
          city: (page.bill_to_address ?? "").split("\n").slice(-1)[0] ?? "Colombo",
        },
      })
    : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink px-4 py-16 text-cream">
      <div className="w-full max-w-md">
        <p className="eyebrow text-[10px]">{page.business_name}</p>
        <h1 className="mt-2 font-display text-[28px] font-normal leading-tight tracking-[-0.03em]">
          Invoice {page.number ?? ""}
        </h1>
        <p className="mt-1 text-[13px] text-sand">
          {[page.bill_to_company || page.bill_to_name, page.subject].filter(Boolean).join(" · ")}
        </p>

        <section className="mt-6 border border-cream/[0.10] bg-cream/[0.03] px-6 py-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-sand">{settled ? "Settled" : "Amount due"}</p>
          <p className="mt-2 font-display text-[36px] font-normal leading-none tracking-[-0.03em] tabular-nums">
            {money(settled ? num(page.total) : balance)}
          </p>
          <p className="mt-2 text-[12.5px] text-sand">
            {settled
              ? "Nothing is owed on this invoice — thank you."
              : page.due_date
                ? `Due ${formatDate(page.due_date)}${num(page.total) !== balance ? ` · ${money(num(page.total) - balance)} already settled` : ""}`
                : "Due on receipt"}
          </p>
        </section>

        {error === "stripe" && (
          <p className="mt-4 text-[12.5px] text-bad-300">Card payment couldn&apos;t start just now — please try again in a moment.</p>
        )}

        {!settled && (
          <div className="mt-5 space-y-2.5">
            {payhere && (
              <form method="post" action={payhereCheckoutUrl()}>
                {Object.entries(payhere).map(([k, v]) => (
                  <input key={k} type="hidden" name={k} value={v} />
                ))}
                <button type="submit" className="btn btn--primary w-full justify-center">
                  Pay {money(balance)} with PayHere
                </button>
              </form>
            )}
            {canStripe && (
              <form method="post" action="/api/pay/stripe/checkout">
                <input type="hidden" name="token" value={token} />
                <button type="submit" className={`btn ${payhere ? "btn--ghost" : "btn--primary"} w-full justify-center`}>
                  Pay {money(balance)} by card
                </button>
              </form>
            )}
            {!payhere && !canStripe && (
              <p className="text-[12.5px] text-sand">
                Online payment isn&apos;t available for this invoice right now. Please use the bank details on the invoice
                {page.business_email ? ` or write to ${page.business_email}` : ""}.
              </p>
            )}
          </div>
        )}

        <p className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          <a href={`/pay/${token}/pdf`} className="text-cream-2 underline-offset-4 hover:underline">
            Download the invoice (PDF)
          </a>
          {page.business_email && (
            <a href={`mailto:${page.business_email}`} className="text-sand underline-offset-4 hover:underline">
              Questions? {page.business_email}
            </a>
          )}
        </p>
        <p className="mt-8 text-[11px] text-sand/70">Payments are handled by PayHere or Stripe — card details never reach {page.business_name}.</p>
      </div>
    </main>
  );
}
