import "server-only";

import { createClient } from "@/lib/supabase/server";
import { INBOX_ADDRESSES, MAILBOX_ADDRESS, MAILBOX_FROM } from "./config";
import { buildSend, checkDraft, createMailbox, unwrap, type StateRow } from "./core";
import { resend } from "./resend";
import type { MailDirection, MailFolder, OutgoingMessage, SentMessage } from "./types";

/**
 * The web admin's mailbox: the shared core (./core.ts) with Resend from the
 * server environment and flags read under the signed-in person's session.
 */

async function loadFlags(ids: string[]) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("email_states")
    .select("email_id, read, starred, archived, trashed")
    .in("email_id", ids)
    .returns<StateRow[]>();
  return data ?? [];
}

const mailbox = () => createMailbox({ resend, loadFlags, inboxAddresses: INBOX_ADDRESSES });

export const listMail = (folder: MailFolder, options?: { q?: string; after?: string }) =>
  mailbox().listMail(folder, options);

/** Unread inbound still sitting in the inbox — the number on the nav badge. */
export const unreadCount = () => mailbox().unreadCount();

/** Full message, body included. Inline images come back as data URIs. */
export const getMail = (id: string, direction: MailDirection) => mailbox().getMail(id, direction);

/** A fresh signed URL for one attachment — they expire, so never cache them. */
export const attachmentUrl = (emailId: string, attachmentId: string, direction: MailDirection) =>
  mailbox().attachmentUrl(emailId, attachmentId, direction);

/**
 * Send one message from the company mailbox — documents, statements,
 * reminders. Throws with a sentence when the draft isn't sendable. (The
 * desktop's copy of this module sends through the mail function instead.)
 */
export async function sendMessage(msg: OutgoingMessage): Promise<SentMessage> {
  const files = msg.attachments ?? [];
  const draft = checkDraft(
    { to: msg.to, cc: msg.cc ?? "", bcc: "", subject: msg.subject, body: msg.body, inReplyTo: "" },
    files.reduce((sum, f) => sum + f.content.byteLength, 0),
  );
  if ("error" in draft) throw new Error(draft.error);
  const sent = unwrap(
    await resend().emails.send(
      buildSend(
        draft,
        files.map((f) => ({ filename: f.filename, content: Buffer.from(f.content).toString("base64"), contentType: f.contentType })),
        { from: MAILBOX_FROM, address: MAILBOX_ADDRESS },
      ),
    ),
  );
  return { id: sent.id, to: [...draft.to], cc: [...draft.cc] };
}
