"use client";

import { useCallback, useRef, useState, useTransition, type ReactNode } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";

type Result = { ok: boolean; error?: string; message?: string; id?: string };

/** What a call that never got an answer reads as — instead of crashing the page. */
function unreachable(e: unknown): Result {
  const tooBig = e instanceof Error && /body exceeded|payload too large|\b413\b/i.test(e.message);
  return {
    ok: false,
    error: tooBig ? "Those files are too large to send at once." : "Couldn't reach the server — try again.",
  };
}

/**
 * Runs a Server Action, refreshes the route, and reports the outcome in a
 * corner toast. Every admin surface mutates through this so success and
 * failure look the same everywhere.
 *
 * The actions catch their own errors, so a rejection here means the request
 * itself failed (offline, a body over the size limit, an action that a deploy
 * replaced). It becomes an error toast rather than an error boundary; Next's
 * own control flow (redirect, notFound) is rethrown untouched.
 *
 * The toast's live region is always mounted, so a screen reader hears the
 * first message too; the toast itself fades in where it lands.
 */
export function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ id: number; tone: "ok" | "bad"; text: string } | null>(null);
  const seq = useRef(0);

  const run = useCallback(
    (fn: () => Promise<Result>, opts: { onDone?: (result: Result) => void; quiet?: boolean } = {}) => {
      startTransition(async () => {
        let result: Result;
        try {
          result = await fn();
        } catch (e) {
          unstable_rethrow(e);
          result = unreachable(e);
        }
        if (!opts.quiet || !result.ok) {
          const id = ++seq.current;
          setToast(
            result.ok
              ? { id, tone: "ok", text: result.message ?? "Done." }
              : { id, tone: "bad", text: result.error ?? "That didn't work." },
          );
          // Only clear this toast — a newer one keeps its full time on screen.
          setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 3400);
        }
        opts.onDone?.(result);
        router.refresh();
      });
    },
    [router],
  );

  const node: ReactNode = (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 right-5 z-[120] max-w-[min(360px,90vw)]"
    >
      {toast && (
        <div
          key={toast.id}
          className={`pointer-events-auto border px-4 py-2.5 text-[12.5px] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] transition-opacity duration-300 starting:opacity-0 motion-reduce:transition-none ${
            toast.tone === "ok" ? "border-terra/40 bg-ink-2 text-cream" : "border-rose-400/40 bg-ink-2 text-rose-200"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );

  return { run, pending, toast: node };
}
