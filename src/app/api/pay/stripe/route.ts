import { createAdminClient } from "@/lib/supabase/admin";
import { stripeVerify } from "@/lib/payments/providers";

/**
 * Stripe's webhook (checkout.session.completed). The signature is checked
 * against STRIPE_WEBHOOK_SECRET before anything is believed; a paid session
 * records the payment on its invoice (record_online_payment, 0039).
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  const event = stripeVerify(raw, req.headers.get("stripe-signature"));
  if (!event) return new Response("bad signature", { status: 400 });
  if (event.type !== "checkout.session.completed") return new Response("ok", { status: 200 });

  const session = event.data.object;
  const token = session.metadata?.pay_token;
  if (session.payment_status !== "paid" || !token || !session.amount_total || !session.currency) {
    return new Response("ok", { status: 200 });
  }
  const { error } = await createAdminClient().rpc("record_online_payment", {
    p_token: token,
    p_provider: "stripe",
    p_reference: session.payment_intent ?? session.id,
    p_amount: session.amount_total / 100,
    p_currency: session.currency.toUpperCase(),
  });
  // A 500 makes Stripe retry later — right when the database didn't take it.
  if (error) {
    console.error("stripe: payment not recorded —", error.message);
    return new Response("not recorded", { status: 500 });
  }
  return new Response("recorded", { status: 200 });
}
