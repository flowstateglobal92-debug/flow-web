import "server-only";

import { Resend } from "resend";

let client: Resend | null = null;

/** Lazily built so importing this module never throws when the key is missing. */
export function resend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Resend is not configured. Set RESEND_API_KEY in .env.local");
  client ??= new Resend(apiKey);
  return client;
}

/**
 * Resend's SDK returns `{ data, error }` rather than throwing. Unwrapping in
 * one place keeps every call site down to a single line and makes the API's own
 * message the one that reaches the toast.
 */
export function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("Resend returned an empty response.");
  return result.data;
}
