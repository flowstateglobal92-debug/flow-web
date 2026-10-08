"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/admin/auth";
import { buildSend, checkDraft, checkForward } from "@/lib/email/core";
import { MAILBOX_ADDRESS, MAILBOX_FROM } from "@/lib/email/config";
import { resend, unwrap } from "@/lib/email/resend";
import type { MailFlags, MailRef } from "@/lib/email/types";
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
    const { supabase, user } = await authorize("email");
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

/**
 * Send a message from the mailbox address.
 *
 * Attachments arrive as real `File`s in the FormData (Next streams them through
 * the Server Action) and go out base64-encoded. Resend's ceiling is 40MB per
 * email *after* encoding, so the raw total is held to 20MB (checkDraft).
 * The checks and the message itself come from @/lib/email/core, shared with
 * the desktop app's mail function.
 */
export async function sendMail(formData: FormData): Promise<ActionResult> {
  try {
    await authorize("email");

    const files = formData.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);
    const draft = checkDraft(
      {
        to: text(formData, "to"),
        cc: text(formData, "cc"),
        bcc: text(formData, "bcc"),
        subject: text(formData, "subject"),
        body: String(formData.get("body") ?? ""),
        inReplyTo: text(formData, "inReplyTo"),
      },
      files.reduce((sum, f) => sum + f.size, 0),
    );
    if ("error" in draft) return fail(new Error(draft.error));

    const attachments = await Promise.all(
      files.map(async (file) => ({
        filename: file.name,
        content: Buffer.from(await file.arrayBuffer()).toString("base64"),
        contentType: file.type || undefined,
      })),
    );

    const sent = unwrap(
      await resend().emails.send(buildSend(draft, attachments, { from: MAILBOX_FROM, address: MAILBOX_ADDRESS })),
    );

    // Sent mail is never unread — seed the row now so Sent renders consistently.
    await setMailFlags([{ id: sent.id, direction: "outbound" }], { read: true });

    revalidatePath("/admin/email");
    return ok(`Sent to ${draft.to.join(", ")}.`);
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
    await authorize("email");

    const checked = checkForward(recipients);
    if ("error" in checked) return fail(new Error(checked.error));
    const { to } = checked;

    unwrap(await resend().emails.receiving.forward({ emailId, to, from: MAILBOX_FROM, passthrough: true }));

    revalidatePath("/admin/email");
    return ok(`Forwarded to ${to.join(", ")}.`);
  } catch (e) {
    return fail(e);
  }
}
