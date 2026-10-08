// The Flow State mailbox for the desktop app.
//
// The web admin reads Resend from its own server; the desktop app has no
// server, and Resend's key must never ship inside an installer. This function
// is that server: the same mailbox core (_shared/email/core.ts, generated from
// src/lib/email/core.ts), the key from this function's secrets, and every
// database read and write made as the caller, so RLS still decides.
//
// POST { op: "list" | "get" | "unread" | "attachment" | "send" | "forward" | "document", … }
//
// "document" sends a document, statement or reminder the app made (0036): it
// needs access to the record's module (Invoices, or Clients for a statement)
// rather than to Email, checks the caller can read the record, and takes PDF
// attachments inline.
// Secrets: RESEND_API_KEY, EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME, EMAIL_INBOX_ADDRESSES (optional).
import { Resend } from "resend";
import { decodeBase64, encodeBase64 } from "@std/encoding/base64";
import { buildSend, checkDraft, checkForward, createMailbox, unwrap, type StateRow } from "../_shared/email/core.ts";
import type { MailDirection, MailFolder } from "../_shared/email/types.ts";
import { body, caller, failed, reply, str, type Caller } from "../_shared/http.ts";

const MAILBOX_ADDRESS = Deno.env.get("EMAIL_FROM_ADDRESS") || "support@flowstate.lk";
const MAILBOX_NAME = Deno.env.get("EMAIL_FROM_NAME") || "Flow State";
const MAILBOX_FROM = `${MAILBOX_NAME} <${MAILBOX_ADDRESS}>`;
const INBOX_ADDRESSES = (Deno.env.get("EMAIL_INBOX_ADDRESSES") ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const OUTBOX = "mail-outbox";
const FOLDERS: MailFolder[] = ["inbox", "starred", "archive", "sent", "trash"];

let client: Resend | null = null;
function resend() {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("The mailbox isn't set up on the server yet (RESEND_API_KEY).");
  client ??= new Resend(key);
  return client;
}

const direction = (v: unknown): MailDirection | null => (v === "inbound" || v === "outbound" ? v : null);

function mailboxFor(who: Caller) {
  return createMailbox({
    resend,
    inboxAddresses: INBOX_ADDRESSES,
    loadFlags: async (ids) => {
      const { data } = await who.supabase
        .from("email_states")
        .select("email_id, read, starred, archived, trashed")
        .in("email_id", ids)
        .returns<StateRow[]>();
      return data ?? [];
    },
  });
}

type OutboxFile = { path: string; filename: string; contentType?: string };

/** Attachments the desktop put in the caller's own outbox folder. */
function readFiles(value: unknown, userId: string): OutboxFile[] | string {
  if (value == null) return [];
  if (!Array.isArray(value)) return "Attachments must be a list.";
  const files: OutboxFile[] = [];
  for (const raw of value) {
    const f = raw as Record<string, unknown>;
    const path = str(f?.path);
    // <user id>/<send id>/<file>, and nothing that climbs out of it.
    if (!path.startsWith(`${userId}/`) || path.includes("..") || path.split("/").length !== 3) {
      return "An attachment isn't in your outbox.";
    }
    files.push({ path, filename: str(f.filename) || path.split("/")[2], contentType: str(f.contentType) || undefined });
  }
  return files;
}

async function send(who: Caller, args: Record<string, unknown>) {
  const files = readFiles(args.attachments, who.user.id);
  if (typeof files === "string") return failed(new Error(files));

  // Read the files first: their real sizes are what the 20MB limit is about.
  const outbox = who.supabase.storage.from(OUTBOX);
  const loaded: { filename: string; contentType?: string; bytes: Uint8Array }[] = [];
  for (const f of files) {
    const { data, error } = await outbox.download(f.path);
    if (error || !data) return failed(new Error(`Couldn't read the attachment ${f.filename} — attach it again.`));
    loaded.push({ filename: f.filename, contentType: f.contentType, bytes: new Uint8Array(await data.arrayBuffer()) });
  }

  const draft = checkDraft(
    {
      to: str(args.to),
      cc: str(args.cc),
      bcc: str(args.bcc),
      subject: str(args.subject),
      body: str(args.body),
      inReplyTo: str(args.inReplyTo),
    },
    loaded.reduce((sum, f) => sum + f.bytes.byteLength, 0),
  );
  if ("error" in draft) return failed(new Error(draft.error));

  const attachments = loaded.map((f) => ({ filename: f.filename, content: encodeBase64(f.bytes), contentType: f.contentType }));
  const sent = unwrap(
    await resend().emails.send(buildSend(draft, attachments, { from: MAILBOX_FROM, address: MAILBOX_ADDRESS })),
  );

  // Sent mail is never unread — seed the row so Sent renders consistently.
  await who.supabase
    .from("email_states")
    .upsert([{ email_id: sent.id, direction: "outbound", read: true, updated_by: who.user.id }], { onConflict: "email_id" });
  if (files.length) await outbox.remove(files.map((f) => f.path));

  return reply({ ok: true, message: `Sent to ${draft.to.join(", ")}.`, id: sent.id });
}

/** A PDF the app rendered for a document it's sending (op "document"). */
async function sendDocument(who: Caller, args: Record<string, unknown>) {
  const about = (args.about ?? {}) as Record<string, unknown>;
  const module = about.module === "clients" ? "clients" : "invoices";
  const { data: allowed } = await who.supabase.rpc("can_access", { p_module: module });
  const { data: viaInvoices } = module === "clients" ? await who.supabase.rpc("can_access", { p_module: "invoices" }) : { data: false };
  if (allowed !== true && viaInvoices !== true) {
    return reply({ ok: false, error: `You don't have access to ${module === "clients" ? "Clients" : "Invoices"}.` }, 403);
  }

  // The record it's about, read as the caller: RLS decides whether it exists for them.
  const invoiceId = str(about.invoiceId);
  const clientId = str(about.clientId);
  if (invoiceId) {
    const { data } = await who.supabase.from("invoices").select("id").eq("id", invoiceId).maybeSingle();
    if (!data) return reply({ ok: false, error: "That document isn't available." }, 404);
  } else if (clientId) {
    const { data } = await who.supabase.from("clients").select("id").eq("id", clientId).maybeSingle();
    if (!data) return reply({ ok: false, error: "That client isn't available." }, 404);
  } else {
    return reply({ ok: false, error: "Which document?" }, 400);
  }

  const raw = Array.isArray(args.attachments) ? (args.attachments as Record<string, unknown>[]) : [];
  if (raw.length > 3) return reply({ ok: false, error: "Three attachments at most." }, 400);
  const files: { filename: string; content: string; contentType: string; size: number }[] = [];
  for (const a of raw) {
    const b64 = str(a?.base64);
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(b64);
    } catch {
      return reply({ ok: false, error: "An attachment couldn't be read." }, 400);
    }
    // Only the PDFs the app renders: anything else goes through Email's own Compose.
    if (bytes.byteLength > 8 * 1024 * 1024 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
      return reply({ ok: false, error: "Only PDF documents can be attached here." }, 400);
    }
    files.push({ filename: str(a.filename).replace(/[^\w.-]+/g, "-").slice(-80) || "document.pdf", content: b64, contentType: "application/pdf", size: bytes.byteLength });
  }

  const draft = checkDraft(
    { to: str(args.to), cc: str(args.cc), bcc: "", subject: str(args.subject), body: str(args.body), inReplyTo: "" },
    files.reduce((sum, f) => sum + f.size, 0),
  );
  if ("error" in draft) return failed(new Error(draft.error));
  const sent = unwrap(
    await resend().emails.send(
      buildSend(draft, files.map(({ filename, content, contentType }) => ({ filename, content, contentType })), {
        from: MAILBOX_FROM,
        address: MAILBOX_ADDRESS,
      }),
    ),
  );
  return reply({ ok: true, message: `Sent to ${draft.to.join(", ")}.`, id: sent.id });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ ok: false, error: "POST only." }, 405);
  try {
    const who = await caller(req);
    if (!who) return reply({ ok: false, error: "Your session has ended. Sign in again." }, 401);

    const args = await body(req);
    if (!args) return reply({ ok: false, error: "Send a JSON body." }, 400);
    // Documents check their own module; everything else is the Email module's.
    if (args.op === "document") return await sendDocument(who, args);

    const { data: allowed } = await who.supabase.rpc("can_access", { p_module: "email" });
    if (allowed !== true) return reply({ ok: false, error: "You don't have access to Email." }, 403);
    const mailbox = mailboxFor(who);

    switch (args.op) {
      case "list": {
        const folder = FOLDERS.includes(args.folder as MailFolder) ? (args.folder as MailFolder) : "inbox";
        const page = await mailbox.listMail(folder, { q: str(args.q).slice(0, 200), after: str(args.after) || undefined });
        return reply({ ok: true, data: page });
      }
      case "get": {
        const dir = direction(args.direction);
        const id = str(args.id);
        if (!dir || !id) return reply({ ok: false, error: "Which message?" }, 400);
        return reply({ ok: true, data: await mailbox.getMail(id, dir) });
      }
      case "unread":
        return reply({ ok: true, data: { count: await mailbox.unreadCount() } });
      case "attachment": {
        const dir = direction(args.direction);
        const emailId = str(args.emailId);
        const attachmentId = str(args.attachmentId);
        if (!dir || !emailId || !attachmentId) return reply({ ok: false, error: "Which attachment?" }, 400);
        const a = await mailbox.attachmentUrl(emailId, attachmentId, dir);
        // A short-lived signed URL; the desktop downloads it straight away.
        return reply({
          ok: true,
          data: { url: a.download_url, filename: a.filename || "attachment", contentType: a.content_type, size: a.size ?? null },
        });
      }
      case "send":
        return await send(who, args);
      case "forward": {
        const emailId = str(args.emailId);
        if (!emailId) return reply({ ok: false, error: "Which message?" }, 400);
        const checked = checkForward(str(args.recipients));
        if ("error" in checked) return failed(new Error(checked.error));
        unwrap(await resend().emails.receiving.forward({ emailId, to: checked.to, from: MAILBOX_FROM, passthrough: true }));
        return reply({ ok: true, message: `Forwarded to ${checked.to.join(", ")}.` });
      }
      default:
        return reply({ ok: false, error: "Unknown request." }, 400);
    }
  } catch (e) {
    return failed(e);
  }
});
