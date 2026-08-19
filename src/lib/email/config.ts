import "server-only";

/**
 * Mailbox configuration.
 *
 * `EMAIL_FROM_ADDRESS` has to be on a domain verified for *sending* in Resend;
 * receiving is a separate capability on the same domain (an MX record) or on
 * the throwaway `<id>.resend.app` address Resend hands out.
 */
export const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";

export const MAILBOX_ADDRESS = process.env.EMAIL_FROM_ADDRESS || "support@flowstate.lk";

export const MAILBOX_NAME = process.env.EMAIL_FROM_NAME || "Flow State";

/** What recipients see in their From column. */
export const MAILBOX_FROM = `${MAILBOX_NAME} <${MAILBOX_ADDRESS}>`;

/**
 * Optional allow-list. Resend's receiving API returns every inbound message on
 * the account; set `EMAIL_INBOX_ADDRESSES` to a comma-separated list to show
 * only the ones addressed to this mailbox. Unset means show everything, which
 * is what you want while testing against a `*.resend.app` address.
 */
export const INBOX_ADDRESSES = (process.env.EMAIL_INBOX_ADDRESSES ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** False until the API key is filled in — the page shows setup steps instead of failing. */
export const RESEND_READY = Boolean(RESEND_API_KEY);
