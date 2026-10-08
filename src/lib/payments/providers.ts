import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Online payment providers (0039), server side only. Keys come from the
 * website's environment and never reach a browser, a build or the desktop:
 *
 *   PAYHERE_MERCHANT_ID, PAYHERE_MERCHANT_SECRET   (PayHere → Integrations;
 *     the secret is made for this site's domain)
 *   PAYHERE_SANDBOX=1                              (test against sandbox.payhere.lk)
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET       (Stripe → Developers)
 *
 * A provider shows on the payment page only when it's switched on in Invoice
 * settings *and* its keys are here.
 */

const md5 = (s: string) => createHash("md5").update(s).digest("hex").toUpperCase();

/* ─────────────────────────────── PayHere ─────────────────────────────── */

/** PayHere takes these (its multi-currency list). */
export const PAYHERE_CURRENCIES = ["LKR", "USD", "GBP", "EUR", "AUD"];

export function payhereReady() {
  return Boolean(process.env.PAYHERE_MERCHANT_ID && process.env.PAYHERE_MERCHANT_SECRET);
}

export const payhereCheckoutUrl = () =>
  process.env.PAYHERE_SANDBOX === "1" ? "https://sandbox.payhere.lk/pay/checkout" : "https://www.payhere.lk/pay/checkout";

/** The hidden fields of PayHere's checkout form, hash included. */
export function payhereFields(input: {
  orderId: string;
  amount: number;
  currency: string;
  items: string;
  token: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  customer: { name: string; email: string; phone: string; address: string; city: string };
}) {
  const merchant = process.env.PAYHERE_MERCHANT_ID!;
  const secret = process.env.PAYHERE_MERCHANT_SECRET!;
  const amount = input.amount.toFixed(2);
  const [first, ...rest] = (input.customer.name || "Customer").trim().split(/\s+/);
  return {
    merchant_id: merchant,
    return_url: input.returnUrl,
    cancel_url: input.cancelUrl,
    notify_url: input.notifyUrl,
    order_id: input.orderId,
    items: input.items.slice(0, 100),
    currency: input.currency,
    amount,
    first_name: first,
    last_name: rest.join(" ") || "-",
    email: input.customer.email || "",
    phone: input.customer.phone || "",
    address: input.customer.address || "",
    city: input.customer.city || "Colombo",
    country: "Sri Lanka",
    custom_1: input.token,
    hash: md5(`${merchant}${input.orderId}${amount}${input.currency}${md5(secret)}`),
  };
}

/** A PayHere notification, checked against md5sig. Null when it isn't genuine. */
export function payhereVerify(fields: Record<string, string>) {
  const secret = process.env.PAYHERE_MERCHANT_SECRET;
  const merchant = process.env.PAYHERE_MERCHANT_ID;
  if (!secret || !merchant || fields.merchant_id !== merchant) return null;
  const expect = md5(
    `${fields.merchant_id}${fields.order_id}${fields.payhere_amount}${fields.payhere_currency}${fields.status_code}${md5(secret)}`,
  );
  const given = String(fields.md5sig ?? "").toUpperCase();
  if (given.length !== expect.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expect))) return null;
  return {
    success: fields.status_code === "2",
    token: fields.custom_1,
    reference: fields.payment_id,
    amount: Number(fields.payhere_amount),
    currency: fields.payhere_currency,
  };
}

/* ─────────────────────────────── Stripe ─────────────────────────────── */

export function stripeReady() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

/** A Checkout Session for the balance; returns the URL to send the payer to. */
export async function stripeCheckout(input: {
  amount: number;
  currency: string;
  name: string;
  token: string;
  invoiceId: string;
  email: string | null;
  successUrl: string;
  cancelUrl: string;
}) {
  const body = new URLSearchParams({
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(Math.round(input.amount * 100)),
    "line_items[0][price_data][product_data][name]": input.name.slice(0, 120),
    "metadata[pay_token]": input.token,
    "payment_intent_data[metadata][pay_token]": input.token,
    client_reference_id: input.invoiceId,
  });
  if (input.email) body.set("customer_email", input.email);
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok || !json.url) throw new Error(json.error?.message ?? "Stripe didn't open a checkout.");
  return json.url;
}

/**
 * A Stripe webhook body, checked against its Stripe-Signature header (v1,
 * five-minute tolerance). Null when it isn't genuine.
 */
export function stripeVerify(raw: string, header: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return null;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return null;
  const expect = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const ok = sigs.some((s) => s.length === expect.length && timingSafeEqual(Buffer.from(s), Buffer.from(expect)));
  if (!ok) return null;
  return JSON.parse(raw) as {
    type: string;
    data: {
      object: {
        id: string;
        payment_status?: string;
        payment_intent?: string | null;
        amount_total?: number;
        currency?: string;
        metadata?: Record<string, string>;
      };
    };
  };
}
