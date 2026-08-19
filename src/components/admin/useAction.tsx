"use client";

import { useCallback, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type Result = { ok: boolean; error?: string; message?: string };

/**
 * Runs a Server Action, refreshes the route, and reports the outcome in a
 * corner toast. Every admin surface mutates through this so success and
 * failure look the same everywhere.
 */
export function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const run = useCallback(
    (fn: () => Promise<Result>, opts: { onDone?: (result: Result) => void; quiet?: boolean } = {}) => {
      startTransition(async () => {
        const result = await fn();
        if (!opts.quiet || !result.ok) {
          setToast(
            result.ok
              ? { tone: "ok", text: result.message ?? "Done." }
              : { tone: "bad", text: result.error ?? "That didn't work." },
          );
          setTimeout(() => setToast(null), 3400);
        }
        opts.onDone?.(result);
        router.refresh();
      });
    },
    [router],
  );

  const node: ReactNode = toast ? (
    <div
      role="status"
      className={`rise-in fixed bottom-5 right-5 z-[120] max-w-[min(360px,90vw)] border px-4 py-2.5 text-[12.5px] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] ${toast.tone === "ok" ? "border-terra/40 bg-ink-2 text-cream" : "border-rose-400/40 bg-ink-2 text-rose-200"
        }`}
    >
      {toast.text}
    </div>
  ) : null;

  return { run, pending, toast: node };
}
