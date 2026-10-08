import { createAdminClient } from "@/lib/supabase/admin";
import { payhereVerify } from "@/lib/payments/providers";

/**
 * PayHere's server-to-server notification (notify_url). Only a notification
 * whose md5sig checks out is believed; a successful one records the payment
 * on the invoice (record_online_payment, 0039 — the same reference twice is
 * one payment). PayHere wants a 200 either way.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData();
  const fields = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const notice = payhereVerify(fields);
  if (!notice) return new Response("ignored", { status: 200 });
  if (!notice.success || !notice.token || !notice.reference) return new Response("noted", { status: 200 });

  const { error } = await createAdminClient().rpc("record_online_payment", {
    p_token: notice.token,
    p_provider: "payhere",
    p_reference: notice.reference,
    p_amount: notice.amount,
    p_currency: notice.currency,
  });
  if (error) console.error("payhere: payment not recorded —", error.message);
  return new Response(error ? "not recorded" : "recorded", { status: 200 });
}
