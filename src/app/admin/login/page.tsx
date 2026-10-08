import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import LoginForm from "./LoginForm";
import { SUPABASE_READY } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; denied?: string }>;
}) {
  const { next, denied } = await searchParams;

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-16">
      {/* Atmosphere — same light language as the public site */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="grid-lines absolute inset-0 opacity-50" />
        <div className="glow-terra absolute left-1/2 top-[38%] h-[46vh] w-[62vw] -translate-x-1/2 -translate-y-1/2 opacity-30" />
        <div className="glow-cream absolute -bottom-24 right-[12%] h-[26vh] w-[26vw] opacity-[0.12]" />
      </div>

      <div className="relative w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <Image
            src="/brand/mark-256.webp"
            alt="Flow State"
            width={250}
            height={256}
            priority
            sizes="52px"
            className="h-[52px] w-auto object-contain drop-shadow-[0_10px_30px_rgba(198,93,59,0.45)]"
          />
          <p className="eyebrow mt-4 text-[10px]">Flow State · Control room</p>
          <h1 className="mt-2 font-display text-[27px] font-medium leading-tight text-cream">Sign in</h1>
          <p className="mt-2 text-[12.5px] text-sand">
            Team access · accounts are issued by your administrator.
          </p>
        </div>

        <div className="glass glass--strong rounded-none p-5">
          {!SUPABASE_READY ? (
            <div className="border border-warn-300/25 bg-warn-400/[0.07] px-3.5 py-3 text-[12.5px] text-warn-100">
              <p className="font-medium">Supabase isn&apos;t configured yet.</p>
              <p className="mt-1.5 text-warn-100/80">
                Copy <code className="font-mono text-[11.5px]">.env.example</code> to{" "}
                <code className="font-mono text-[11.5px]">.env.local</code>, add your project URL and anon key, then
                restart the dev server.
              </p>
            </div>
          ) : (
            <LoginForm next={next} denied={denied === "1"} />
          )}
        </div>

        <p className="mt-6 text-center text-[11.5px] text-sand/80">
          <Link href="/" className="underline-offset-4 transition-colors hover:text-cream hover:underline">
            Back to flowstate.lk
          </Link>
        </p>
      </div>
    </main>
  );
}
