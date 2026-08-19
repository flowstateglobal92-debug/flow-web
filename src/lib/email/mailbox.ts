import "server-only";

import { createClient } from "@/lib/supabase/server";
import { INBOX_ADDRESSES } from "./config";
import { resend, unwrap } from "./resend";
import { parseAddress } from "./address";
import type {
  MailAttachment,
  MailDetail,
  MailDirection,
  MailFlags,
  MailFolder,
  MailPage,
  MailSummary,
} from "./types";

/** Resend caps a page at 100; the mailbox asks for the lot and filters locally. */
const WINDOW = 100;

const UNSEEN: MailFlags = { read: false, starred: false, archived: false, trashed: false };
/** Nothing "arrives" in Sent, so outbound mail is never unread. */
const SENT: MailFlags = { ...UNSEEN, read: true };

type StateRow = {
  email_id: string;
  read: boolean;
  starred: boolean;
  archived: boolean;
  trashed: boolean;
};

/** Local flags for a batch of Resend ids, defaulted for anything never touched. */
async function flagsFor(ids: string[]) {
  const map = new Map<string, StateRow>();
  if (!ids.length) return map;

  const supabase = await createClient();
  const { data } = await supabase
    .from("email_states")
    .select("email_id, read, starred, archived, trashed")
    .in("email_id", ids)
    .returns<StateRow[]>();

  for (const row of data ?? []) map.set(row.email_id, row);
  return map;
}

const flagsOf = (id: string, direction: MailDirection, states: Map<string, StateRow>): MailFlags => {
  const row = states.get(id);
  const base = direction === "outbound" ? SENT : UNSEEN;
  return row
    ? { read: row.read, starred: row.starred, archived: row.archived, trashed: row.trashed }
    : { ...base };
};

/** True when the message was addressed to one of ours (or no allow-list is set). */
function isOurs(to: string[], receivedFor: string[]) {
  if (!INBOX_ADDRESSES.length) return true;
  const seen = [...to, ...receivedFor].map((a) => parseAddress(a).address.toLowerCase());
  return seen.some((a) => INBOX_ADDRESSES.includes(a));
}

const inFolder = (mail: MailSummary, folder: MailFolder) => {
  const { starred, archived, trashed } = mail.flags;
  if (folder === "trash") return trashed;
  if (trashed) return false;
  if (folder === "starred") return starred;
  if (folder === "archive") return archived;
  if (folder === "sent") return mail.direction === "outbound";
  return mail.direction === "inbound" && !archived;
};

const matches = (mail: MailSummary, q: string) => {
  if (!q) return true;
  const term = q.toLowerCase();
  return [mail.subject, mail.from.name, mail.from.address, ...mail.to, ...mail.cc]
    .join(" ")
    .toLowerCase()
    .includes(term);
};

/* ─────────────────────────────── listing ─────────────────────────────── */

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
export async function listMail(
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
export async function unreadCount() {
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

/* ─────────────────────────────── reading ─────────────────────────────── */

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

/** Full message, body included. Inline images come back as data URIs. */
export async function getMail(id: string, direction: MailDirection): Promise<MailDetail> {
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
export async function attachmentUrl(emailId: string, attachmentId: string, direction: MailDirection) {
  const api = resend();
  const result =
    direction === "inbound"
      ? await api.emails.receiving.attachments.get({ emailId, id: attachmentId })
      : await api.emails.attachments.get({ emailId, id: attachmentId });
  return unwrap(result);
}
