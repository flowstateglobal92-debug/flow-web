import { requireAdmin } from "@/lib/admin/auth";
import { attachmentUrl } from "@/lib/email/mailbox";
import type { MailDirection } from "@/lib/email/types";

/** Signed URLs expire within the hour — never let a CDN hold on to one. */
export const dynamic = "force-dynamic";

/**
 * Streams one attachment back through the admin.
 *
 * Resend hands out a short-lived signed URL rather than the bytes, and that URL
 * is public to anyone holding it. Proxying keeps it server-side, puts the
 * download behind `requireAdmin`, and lets the browser see the real filename.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ direction: string; emailId: string; attachmentId: string }> },
) {
  await requireAdmin();

  const { direction, emailId, attachmentId } = await params;
  if (direction !== "inbound" && direction !== "outbound") {
    return new Response("Unknown mailbox side.", { status: 400 });
  }

  let attachment;
  try {
    attachment = await attachmentUrl(emailId, attachmentId, direction as MailDirection);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Attachment unavailable.", { status: 404 });
  }

  const upstream = await fetch(attachment.download_url);
  if (!upstream.ok || !upstream.body) {
    return new Response("Could not download that attachment.", { status: 502 });
  }

  // CR/LF and quotes would let a crafted filename inject its own headers.
  const name = (attachment.filename || "attachment").replace(/[\r\n"\\]/g, "");
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");

  return new Response(upstream.body, {
    headers: {
      "Content-Type": attachment.content_type || "application/octet-stream",
      // Anyone can email an .html file. `attachment` means the browser saves it
      // instead of rendering it on this origin, `nosniff` stops it being
      // re-typed on the way, and the sandbox CSP neutralises it even if some
      // future path did end up rendering it.
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      ...(attachment.size ? { "Content-Length": String(attachment.size) } : {}),
      "Cache-Control": "private, no-store",
    },
  });
}
