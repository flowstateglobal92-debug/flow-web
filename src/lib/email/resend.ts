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

/** Kept here so existing imports keep working; the helper lives in ./core. */
export { unwrap } from "./core";
