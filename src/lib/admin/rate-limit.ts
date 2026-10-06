import "server-only";

import { headers } from "next/headers";

/**
 * Fixed-window attempt counters, in this server instance's memory. Best
 * effort: serverless instances don't share them, so the real bound is the
 * limit times the instances in play — still enough to stop one client from
 * hammering a public form. GoTrue keeps its own limits behind this one.
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();
const MAX_KEYS = 5_000;

/** Count one attempt for `key`; `ok: false` once more than `limit` land inside `windowMs`. */
export function hit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    if (windows.size >= MAX_KEYS) prune(now);
    w = { count: 0, resetAt: now + windowMs };
    windows.set(key, w);
  }
  w.count += 1;
  return { ok: w.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
}

function prune(now: number) {
  for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
  // Still full of live windows: drop the oldest rather than grow without bound.
  while (windows.size >= MAX_KEYS) {
    const oldest = windows.keys().next().value;
    if (oldest === undefined) break;
    windows.delete(oldest);
  }
}

/**
 * The caller's address as the host saw it. Netlify's own header first (a
 * client can't set it), then the usual proxy headers. "unknown" groups every
 * request without one under a single counter.
 */
export async function clientAddress() {
  const h = await headers();
  return (
    h.get("x-nf-client-connection-ip") ??
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
