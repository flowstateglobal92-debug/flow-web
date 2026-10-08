// GENERATED from src/lib/email/core.ts by scripts/sync-edge-shared.mjs — edit the source, not this copy.
/**
 * The mailbox, independent of where it runs.
 *
 * The web admin (src/lib/email/mailbox.ts, Server Actions) and the desktop
 * app's mail function (supabase/functions/mail) are both built on this file,
 * so folders, flags, message shapes and every sentence a person reads stay the
 * same in both. Nothing here reads the environment or touches a framework:
 * callers hand in the Resend client, a flag loader and the mailbox settings.
 *
 * The Edge Function gets a generated copy — edit this file, then run
 * `node scripts/sync-edge-shared.mjs`.
 */
import type { Resend } from "resend";
import { isEmail, parseAddress, splitAddresses } from "./address.ts";
import {
  MAX_ATTACHMENT_BYTES,
  type MailAttachment,
  type MailDetail,
  type MailDirection,
  type MailFlags,
  type MailFolder,
  type MailPage,
  type MailSummary,
} from "./types.ts";

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

/** Resend caps a page at 100; the mailbox asks for the lot and filters locally. */
const WINDOW = 100;

const UNSEEN: MailFlags = { read: false, starred: false, archived: false, trashed: false };
/** Nothing "arrives" in Sent, so outbound mail is never unread. */
const SENT: MailFlags = { ...UNSEEN, read: true };

/** One row of public.email_states — the local flags for a Resend message. */
export type StateRow = {
  email_id: string;
  read: boolean;
  starred: boolean;
  archived: boolean;
  trashed: boolean;
};

export type MailboxDeps = {
  /** Called only when Resend is actually needed, so a missing key surfaces where it's handled. */
  resend: () => Resend;
  /** Flags for these Resend ids (rows that were never touched are simply absent). */
  loadFlags: (ids: string[]) => Promise<StateRow[]>;
  /** EMAIL_INBOX_ADDRESSES, lower-cased. Empty shows everything. */
  inboxAddresses: string[];
};

export const flagsOf = (id: string, direction: MailDirection, states: Map<string, StateRow>): MailFlags => {
  const row = states.get(id);
  const base = direction === "outbound" ? SENT : UNSEEN;
  return row
    ? { read: row.read, starred: row.starred, archived: row.archived, trashed: row.trashed }
    : { ...base };
};

export const inFolder = (mail: MailSummary, folder: MailFolder) => {
  const { starred, archived, trashed } = mail.flags;
  if (folder === "trash") return trashed;
  if (trashed) return false;
  if (folder === "starred") return starred;
  if (folder === "archive") return archived;
  if (folder === "sent") return mail.direction === "outbound";
  return mail.direction === "inbound" && !archived;
};

export const matches = (mail: MailSummary, q: string) => {
  if (!q) return true;
  const term = q.toLowerCase();
  return [mail.subject, mail.from.name, mail.from.address, ...mail.to, ...mail.cc]
    .join(" ")
    .toLowerCase()
    .includes(term);
};

const attachmentOf = (a: {
  id: string;
  filename?: string | null;
  content_type: string;
  size: number;
  content_id?: string | null;
  content_disposition?: string | null;
}): MailAttachment => ({
  id: a.id,
  filename: a.filename || "attachment",
  contentType: a.content_type,
  size: a.size,
  inline: a.content_disposition === "inline" || Boolean(a.content_id),
});

/** The mailbox reads, bound to one Resend account and one flag store. */
export function createMailbox({ resend, loadFlags, inboxAddresses }: MailboxDeps) {
  /** Local flags for a batch of Resend ids, defaulted for anything never touched. */
  async function flagsFor(ids: string[]) {
    const map = new Map<string, StateRow>();
    if (!ids.length) return map;
    for (const row of await loadFlags(ids)) map.set(row.email_id, row);
    return map;
  }

  /** True when the message was addressed to one of ours (or no allow-list is set). */
  function isOurs(to: string[], receivedFor: string[]) {
    if (!inboxAddresses.length) return true;
    const seen = [...to, ...receivedFor].map((a) => parseAddress(a).address.toLowerCase());
    return seen.some((a) => inboxAddresses.includes(a));
  }

  async function inboundPage(after?: string) {
    const page = unwrap(await resend().emails.receiving.list({ limit: WINDOW, ...(after ? { after } : {}) }));
    const items: MailSummary[] = page.data
      .filter((m) => isOurs(m.to ?? [], m.received_for ?? []))
      .map((m) => ({
        id: m.id,
        direction: "inbound" as const,
        from: parseAddress(m.from),
        to: m.to ?? [],
        cc: m.cc ?? [],
        subject: m.subject || "(no subject)",
        date: m.created_at,
        attachments: (m.attachments ?? []).filter((a) => a.content_disposition !== "inline").length,
        flags: { ...UNSEEN },
      }));
    return { items, hasMore: page.has_more };
  }

  async function outboundPage(after?: string) {
    const page = unwrap(await resend().emails.list({ limit: WINDOW, ...(after ? { after } : {}) }));
    const items: MailSummary[] = page.data.map((m) => ({
      id: m.id,
      direction: "outbound" as const,
      from: parseAddress(m.from),
      to: m.to ?? [],
      cc: m.cc ?? [],
      subject: m.subject || "(no subject)",
      date: m.created_at,
      attachments: 0,
      flags: { ...SENT },
      status: m.last_event,
    }));
    return { items, hasMore: page.has_more };
  }

  /** Runs one side of the mailbox, turning a failure into a warning string. */
  async function soft(label: string, load: () => Promise<{ items: MailSummary[]; hasMore: boolean }>) {
    try {
      return { ...(await load()), warning: null as string | null };
    } catch (e) {
      return {
        items: [] as MailSummary[],
        hasMore: false,
        warning: `${label} mail is unavailable: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  /**
   * One page of a folder.
   *
   * Inbox and Sent read a single Resend endpoint and can therefore page with a
   * cursor. Starred / Archive / Trash span both directions, so they take the most
   * recent window from each and merge — those shelves stay small by nature.
   */
  async function listMail(
    folder: MailFolder,
    { q = "", after }: { q?: string; after?: string } = {},
  ): Promise<MailPage> {
    const both = folder !== "inbox" && folder !== "sent";
    const cursor = both ? undefined : after;

    // One side failing — receiving not switched on yet, a send-only API key —
    // shouldn't blank the other. Each is settled on its own and reported.
    const [inbound, outbound] = await Promise.all([
      folder === "sent" ? null : soft("Inbound", () => inboundPage(cursor)),
      folder === "inbox" ? null : soft("Sent", () => outboundPage(cursor)),
    ]);

    const warnings = [inbound?.warning, outbound?.warning].filter((w): w is string => Boolean(w));
    const raw = [...(inbound?.items ?? []), ...(outbound?.items ?? [])];
    const states = await flagsFor(raw.map((m) => m.id));

    const items = raw
      .map((m) => ({ ...m, flags: flagsOf(m.id, m.direction, states) }))
      .filter((m) => inFolder(m, folder) && matches(m, q.trim()))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

    const hasMore = both ? false : Boolean(inbound?.hasMore ?? outbound?.hasMore);

    return { items, hasMore, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null, warnings };
  }

  /** Unread inbound still sitting in the inbox — the number on the nav badge. */
  async function unreadCount() {
    try {
      const { items } = await inboundPage();
      const states = await flagsFor(items.map((m) => m.id));
      return items.filter((m) => {
        const flags = flagsOf(m.id, "inbound", states);
        return !flags.read && !flags.archived && !flags.trashed;
      }).length;
    } catch {
      return 0;
    }
  }

  /** Full message, body included. Inline images come back as data URIs. */
  async function getMail(id: string, direction: MailDirection): Promise<MailDetail> {
    const states = await flagsFor([id]);
    const flags = flagsOf(id, direction, states);

    if (direction === "inbound") {
      const m = unwrap(await resend().emails.receiving.get(id, { html_format: "data_uri" }));
      const attachmentList = (m.attachments ?? []).map(attachmentOf);
      return {
        id: m.id,
        direction,
        from: parseAddress(m.from),
        to: m.to ?? [],
        cc: m.cc ?? [],
        bcc: m.bcc ?? [],
        replyTo: m.reply_to ?? [],
        subject: m.subject || "(no subject)",
        date: m.created_at,
        messageId: m.message_id,
        html: m.html,
        text: m.text,
        attachmentList,
        attachments: attachmentList.filter((a) => !a.inline).length,
        flags,
      };
    }

    const m = unwrap(await resend().emails.get(id));
    // Sent attachments live behind their own endpoint, and older accounts 404 it.
    let attachmentList: MailAttachment[] = [];
    try {
      const list = unwrap(await resend().emails.attachments.list({ emailId: id, limit: 100 }));
      attachmentList = list.data.map(attachmentOf);
    } catch {
      attachmentList = [];
    }

    return {
      id: m.id,
      direction,
      from: parseAddress(m.from),
      to: m.to ?? [],
      cc: m.cc ?? [],
      bcc: m.bcc ?? [],
      replyTo: m.reply_to ?? [],
      subject: m.subject || "(no subject)",
      date: m.created_at,
      messageId: m.message_id,
      html: m.html,
      text: m.text,
      attachmentList,
      attachments: attachmentList.filter((a) => !a.inline).length,
      flags,
      status: m.last_event,
    };
  }

  /** A fresh signed URL for one attachment — they expire, so never cache them. */
  async function attachmentUrl(emailId: string, attachmentId: string, direction: MailDirection) {
    const api = resend();
    const result =
      direction === "inbound"
        ? await api.emails.receiving.attachments.get({ emailId, id: attachmentId })
        : await api.emails.attachments.get({ emailId, id: attachmentId });
    return unwrap(result);
  }

  return { listMail, unreadCount, getMail, attachmentUrl };
}

/* ───────────────────────────── composing ────────────────────────────── */

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text → a readable HTML part, so both halves of the message agree. */
export const bodyToHtml = (body: string) =>
  `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#1b1a18;white-space:pre-wrap">${escape(
    body,
  )}</div>`;

export type OutgoingDraft = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  /** Message-ID of the mail being answered. */
  inReplyTo: string;
};

/** What the mailbox knows about itself. */
export type MailboxIdentity = { from: string; address: string };

/** The parts of a send that only need the form — checked before any file is read. */
export function checkDraft(draft: OutgoingDraft, attachmentBytes: number) {
  const to = splitAddresses(draft.to);
  const cc = splitAddresses(draft.cc);
  const bcc = splitAddresses(draft.bcc);
  const subject = draft.subject.trim();
  const body = draft.body;

  if (!to.length) return { error: "Add at least one recipient." } as const;
  const bad = [...to, ...cc, ...bcc].find((a) => !isEmail(a));
  if (bad) return { error: `"${bad}" isn't a valid email address.` } as const;
  if (!subject) return { error: "Give the message a subject." } as const;
  if (!body.trim()) return { error: "The message is empty." } as const;
  if (attachmentBytes > MAX_ATTACHMENT_BYTES) {
    return { error: `Attachments total ${(attachmentBytes / 1024 / 1024).toFixed(1)}MB — the limit is 20MB.` } as const;
  }
  return { to, cc, bcc, subject, body, inReplyTo: draft.inReplyTo.trim() } as const;
}

/**
 * The Resend payload for a checked draft. `inReplyTo` carries the original
 * Message-ID, which is what makes the reply land inside the same thread in the
 * recipient's client rather than as a new conversation.
 */
export function buildSend(
  draft: { to: string[]; cc: string[]; bcc: string[]; subject: string; body: string; inReplyTo: string },
  attachments: { filename: string; content: string; contentType?: string }[],
  mailbox: MailboxIdentity,
) {
  const headers: Record<string, string> = draft.inReplyTo
    ? { "In-Reply-To": draft.inReplyTo, References: draft.inReplyTo }
    : {};
  return {
    from: mailbox.from,
    to: draft.to,
    ...(draft.cc.length ? { cc: draft.cc } : {}),
    ...(draft.bcc.length ? { bcc: draft.bcc } : {}),
    replyTo: mailbox.address,
    subject: draft.subject,
    text: draft.body,
    html: bodyToHtml(draft.body),
    ...(attachments.length ? { attachments } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
  };
}

/** Recipients for a forward, or the sentence explaining what's wrong. */
export function checkForward(recipients: string) {
  const to = splitAddresses(recipients);
  if (!to.length) return { error: "Add at least one recipient." } as const;
  const bad = to.find((a) => !isEmail(a));
  if (bad) return { error: `"${bad}" isn't a valid email address.` } as const;
  return { to } as const;
}
