import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Thank you", robots: { index: false, follow: false } };

/**
 * Where PayHere and Stripe send the payer back. Says thanks; the payment
 * itself is recorded when the provider confirms it to the website, which can
 * take a moment.
 */
export default async function PaidPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink px-4 py-16 text-cream">
      <div className="w-full max-w-md text-center">
        <p className="eyebrow text-[10px]">Payment</p>
        <h1 className="mt-2 font-display text-[28px] font-normal tracking-[-0.03em]">Thank you</h1>
        <p className="mt-3 text-[13px] text-sand">
          Your payment is on its way to us. The invoice updates as soon as the payment provider confirms it — usually
          within a minute.
        </p>
        {/^[0-9a-f]{32}$/.test(token) && (
          <Link href={`/pay/${token}`} className="mt-6 inline-block text-[12.5px] text-cream-2 underline-offset-4 hover:underline">
            Back to the invoice
          </Link>
        )}
      </div>
    </main>
  );
}
