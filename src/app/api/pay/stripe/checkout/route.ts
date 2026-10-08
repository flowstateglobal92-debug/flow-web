import { createAdminClient } from "@/lib/supabase/admin";
import { stripeCheckout, stripeReady } from "@/lib/payments/providers";
import { SITE } from "@/lib/site";

/**
 * The payment page's "Pay by card": a Stripe Checkout for what's left on the
 * invoice behind the token, then a 303 to Stripe. The amount comes from the
 * database, never from the form.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  const back = `${SITE.url}/pay/${encodeURIComponent(token)}`;
  if (!/^[0-9a-f]{32}$/.test(token) || !stripeReady()) return Response.redirect(back, 303);

  const { data } = await createAdminClient().rpc("payment_page", { p_token: token });
  const page = data as { invoice_id: string; number: string | null; currency: string; balance_due: number; bill_to_email: string | null; stripe: boolean; business_name: string } | null;
  if (!page || !page.stripe || !(Number(page.balance_due) > 0)) return Response.redirect(back, 303);

  try {
    const url = await stripeCheckout({
      amount: Number(page.balance_due),
      currency: page.currency,
      name: `${page.business_name} · invoice ${page.number ?? ""}`.trim(),
      token,
      invoiceId: page.invoice_id,
      email: page.bill_to_email,
      successUrl: `${back}/done`,
      cancelUrl: back,
    });
    return Response.redirect(url, 303);
  } catch (e) {
    console.error("stripe checkout:", e instanceof Error ? e.message : e);
    return Response.redirect(`${back}?error=stripe`, 303);
  }
}
