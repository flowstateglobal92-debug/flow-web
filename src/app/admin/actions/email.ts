"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { isEmail, splitAddresses } from "@/lib/email/address";
import { MAILBOX_ADDRESS, MAILBOX_FROM } from "@/lib/email/config";
import { resend, unwrap } from "@/lib/email/resend";
import { MAX_ATTACHMENT_BYTES, type MailFlags, type MailRef } from "@/lib/email/types";
import { fail, ok, text, type ActionResult } from "./shared";

/* ───────────────────────────── flags ────────────────────────────────── */

/**
 * Write the local read/star/archive/trash flags for a set of messages.
 *
 * Rows are created on first touch, so a mailbox that has never been opened
 * costs nothing. Sent mail is always stored as read — nothing arrives there.
 */
export async function setMailFlags(refs: MailRef[], patch: Partial<MailFlags>): Promise<ActionResult> {
  if (!refs.length) return ok();
  try {
    const { supabase, user } = await requireAdmin();
    const rows = refs.map((ref) => ({
      email_id: ref.id,
      direction: ref.direction,
      ...(ref.direction === "outbound" ? { read: true } : {}),
      ...patch,
      updated_by: user.id,
    }));

    const { error } = await supabase.from("email_states").upsert(rows, { onConflict: "email_id" });
    if (error) throw error;

    revalidatePath("/admin/email");
    revalidatePath("/admin");
    return ok(`${refs.length} message${refs.length === 1 ? "" : "s"} updated.`);
  } catch (e) {
    return fail(e);
  }
}

/** Fired when a message is opened. Quiet by design — no toast, no message. */
export async function markMailRead(ref: MailRef): Promise<ActionResult> {
  return setMailFlags([ref], { read: true });
}

/* ───────────────────────────── sending ──────────────────────────────── */

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text → a readable HTML part, so both halves of the message agree. */
const bodyToHtml = (body: string) =>
  `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#1b1a18;white-space:pre-wrap">${escape(
    body,
  )}</div>`;

/**
 * Send a message from the mailbox address.
 *
 * Attachments arrive as real `File`s in the FormData (Next streams them through
 * the Server Action) and go out base64-encoded. Resend's ceiling is 40MB per
 * email *after* encoding, so the raw total is held to 20MB here.
 *
 * `inReplyTo` carries the original Message-ID, which is what makes the reply
 * land inside the same thread in the recipient's client rather than as a new
 * conversation.
 */
export async function sendMail(formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();

    const to = splitAddresses(text(formData, "to"));
    const cc = splitAddresses(text(formData, "cc"));
    const bcc = splitAddresses(text(formData, "bcc"));
    const subject = text(formData, "subject");
    const body = String(formData.get("body") ?? "");

    if (!to.length) return fail(new Error("Add at least one recipient."));
    const bad = [...to, ...cc, ...bcc].find((a) => !isEmail(a));
    if (bad) return fail(new Error(`"${bad}" isn't a valid email address.`));
    if (!subject) return fail(new Error("Give the message a subject."));
    if (!body.trim()) return fail(new Error("The message is empty."));

    const files = formData.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);
    const total = files.reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_ATTACHMENT_BYTES) {
      return fail(new Error(`Attachments total ${(total / 1024 / 1024).toFixed(1)}MB — the limit is 20MB.`));
    }

    const attachments = await Promise.all(
      files.map(async (file) => ({
        filename: file.name,
        content: Buffer.from(await file.arrayBuffer()).toString("base64"),
        contentType: file.type || undefined,
      })),
    );

    const inReplyTo = text(formData, "inReplyTo");
    const headers: Record<string, string> = inReplyTo
      ? { "In-Reply-To": inReplyTo, References: inReplyTo }
      : {};

    const sent = unwrap(
      await resend().emails.send({
        from: MAILBOX_FROM,
        to,
        ...(cc.length ? { cc } : {}),
        ...(bcc.length ? { bcc } : {}),
        replyTo: MAILBOX_ADDRESS,
        subject,
        text: body,
        html: bodyToHtml(body),
        ...(attachments.length ? { attachments } : {}),
        ...(Object.keys(headers).length ? { headers } : {}),
      }),
    );

    // Sent mail is never unread — seed the row now so Sent renders consistently.
    await setMailFlags([{ id: sent.id, direction: "outbound" }], { read: true });

    revalidatePath("/admin/email");
    return ok(`Sent to ${to.join(", ")}.`);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Forward an inbound message with its attachments intact.
 *
 * Resend re-sends the original MIME part-for-part in passthrough mode, which is
 * the only way to forward the files without downloading and re-uploading them.
 * Sent mail has no equivalent endpoint, so this is inbound-only.
 */
export async function forwardMail(emailId: string, recipients: string): Promise<ActionResult> {
  try {
    await requireAdmin();

    const to = splitAddresses(recipients);
    if (!to.length) return fail(new Error("Add at least one recipient."));
    const bad = to.find((a) => !isEmail(a));
    if (bad) return fail(new Error(`"${bad}" isn't a valid email address.`));

    unwrap(await resend().emails.receiving.forward({ emailId, to, from: MAILBOX_FROM, passthrough: true }));

    revalidatePath("/admin/email");
    return ok(`Forwarded to ${to.join(", ")}.`);
  } catch (e) {
    return fail(e);
  }
}
