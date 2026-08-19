import type { MailAddress } from "./types";

/**
 * Split a header value into name and address.
 *
 * Handles `Jane Doe <jane@acme.com>`, `"Doe, Jane" <jane@acme.com>` and a bare
 * `jane@acme.com`. When there's no display name the local part stands in, so
 * avatars and list rows always have something readable to show.
 */
export function parseAddress(raw: string | null | undefined): MailAddress {
  const value = (raw ?? "").trim();
  if (!value) return { name: "Unknown", address: "" };

  const angled = value.match(/^(.*)<([^>]+)>\s*$/);
  const address = (angled ? angled[2] : value).trim();
  const label = angled ? angled[1].trim().replace(/^"(.*)"$/, "$1") : "";

  return { name: label || address.split("@")[0] || address, address };
}

/** `jane@acme.com, Bob <bob@acme.com>` → both addresses. Empty entries dropped. */
export function splitAddresses(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validates the address part only — display names are allowed around it. */
export const isEmail = (value: string) => EMAIL.test(parseAddress(value).address);

/** First line of a reply subject: `Re: …`, without stacking prefixes. */
export const replySubject = (subject: string) =>
  /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim() || "(no subject)"}`;

export const forwardSubject = (subject: string) =>
  /^fwd?:/i.test(subject.trim()) ? subject.trim() : `Fwd: ${subject.trim() || "(no subject)"}`;
