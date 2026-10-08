"use client";

import { useState } from "react";
import Modal from "@/components/admin/Modal";
import { Icon } from "@/components/admin/icons";
import { Button, Field, Input, Notice, Textarea } from "@/components/admin/ui";
import type { useAction } from "@/components/admin/useAction";
import { formatDateTime } from "@/lib/admin/format";
import type { DocumentEmail } from "@/lib/admin/invoice-types";
import { documentEmailDraft, documentPdf, emailDocument, paymentLink, type EmailDraft } from "@/app/admin/actions/documents";

type Run = ReturnType<typeof useAction>["run"];

/** Save the PDF the server rendered (base64) as a file. */
function saveFile(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

type PdfResult = { ok: boolean; error?: string; base64?: string; filename?: string };

/** "PDF": the same file the email attaches, downloaded. */
export function DownloadPdfButton({
  id,
  run,
  pending,
  load,
}: {
  id?: string;
  run: Run;
  pending: boolean;
  /** Something other than a document's PDF (a statement). */
  load?: () => Promise<PdfResult>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="quiet"
      disabled={pending || busy}
      onClick={() => {
        setBusy(true);
        run(
          async () => {
            const res = load ? await load() : await documentPdf(id!);
            if (res.ok && res.base64 && res.filename) saveFile(res.base64, res.filename);
            return res.ok ? { ok: true } : res;
          },
          { quiet: true, onDone: () => setBusy(false) },
        );
      }}
      className="min-h-9"
    >
      <Icon.download size={13} /> {busy ? "Preparing…" : "PDF"}
    </Button>
  );
}

type DraftResult = { ok: boolean; error?: string; draft?: EmailDraft };
type SendResult = { ok: boolean; error?: string; message?: string; id?: string };

/** "Email": recipients and wording filled in from the settings; the PDF goes with it. */
export function EmailDocumentButton({
  id,
  label,
  run,
  pending,
  primary = false,
  loadDraft,
  send,
}: {
  id?: string;
  /** "invoice" / "quote" / "credit note" / "statement" — for the dialog's words. */
  label: string;
  run: Run;
  pending: boolean;
  primary?: boolean;
  /** Something other than a document (a statement): its draft and its send. */
  loadDraft?: () => Promise<DraftResult>;
  send?: (draft: EmailDraft) => Promise<SendResult>;
}) {
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const open = async () => {
    setProblem(null);
    setLoading(true);
    try {
      const res = loadDraft ? await loadDraft() : await documentEmailDraft(id!);
      if (res.ok && res.draft) setDraft(res.draft);
      else setProblem(res.error ?? "Couldn't prepare the email.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button variant={primary ? "primary" : "ghost"} disabled={pending || loading} onClick={open} className="min-h-9">
        <Icon.mail size={13} /> {loading ? "Preparing…" : "Email"}
      </Button>
      {problem && !draft && (
        <Modal open onClose={() => setProblem(null)} title="Can't email it yet">
          <p className="text-[12.5px] text-cream-2">{problem}</p>
        </Modal>
      )}
      {draft && (
        <Modal
          open
          onClose={() => setDraft(null)}
          title={`Email this ${label}`}
          hint={`From the company mailbox, with ${draft.filename} attached.`}
          width="max-w-xl"
        >
          <div className="space-y-3">
            {draft.needsIssue && (
              <Notice tone="info" title="It's still a draft">
                Sending issues it first, so it goes out with its number.
              </Notice>
            )}
            <Field label="To" hint="Separate several with commas.">
              <Input value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} type="text" autoFocus={!draft.to} />
            </Field>
            <Field label="Cc">
              <Input value={draft.cc} onChange={(e) => setDraft({ ...draft, cc: e.target.value })} type="text" />
            </Field>
            <Field label="Subject">
              <Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
            </Field>
            <Field label="Message">
              <Textarea rows={9} value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} />
            </Field>
            <p className="flex items-center gap-1.5 text-[11.5px] text-sand">
              <Icon.paperclip size={12} /> {draft.filename}
            </p>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
            <Button onClick={() => setDraft(null)} className="min-h-9">
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={pending || !draft.to.trim() || !draft.subject.trim() || !draft.message.trim()}
              onClick={() =>
                run(
                  () =>
                    send
                      ? send(draft)
                      : emailDocument(id!, {
                          to: draft.to,
                          cc: draft.cc,
                          subject: draft.subject,
                          message: draft.message,
                          issueFirst: draft.needsIssue,
                        }),
                  { onDone: (r) => r.ok && setDraft(null) },
                )
              }
              className="min-h-9"
            >
              <Icon.send size={13} /> {draft.needsIssue ? "Issue & send" : "Send"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Where a document has been sent — newest first, the rest folded away. */
export function SentHistory({ emails, names }: { emails: DocumentEmail[]; names: Record<string, string> }) {
  const [all, setAll] = useState(false);
  if (emails.length === 0) return null;
  const shown = all ? emails : emails.slice(0, 3);
  return (
    <div className="no-print mb-5 border border-cream/[0.08] bg-cream/[0.02] px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-sand">Sent · {emails.length}</p>
      <ul className="mt-2 space-y-1.5">
        {shown.map((m) => (
          <li key={m.id} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
            <Icon.send size={11} className="text-sand" />
            <span className="text-cream-2">
              {m.kind === "reminder" ? `Reminder${m.step ? ` ${m.step}` : ""} to ` : "To "}
              {m.to_addresses.join(", ")}
            </span>
            <span className="text-sand">
              {formatDateTime(m.sent_at)}
              {m.sent_by ? ` · ${names[m.sent_by] ?? "a teammate"}` : " · automatically"}
            </span>
          </li>
        ))}
      </ul>
      {emails.length > 3 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1.5 min-h-8 text-[11.5px] text-sand hover:text-cream">
          {all ? "Show fewer" : `Show all ${emails.length}`}
        </button>
      )}
    </div>
  );
}

/** "Payment link": the invoice's pay-online page (0039), copied to the clipboard. */
export function PaymentLinkButton({ id, run, pending }: { id: string; run: Run; pending: boolean }) {
  const [link, setLink] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="quiet"
        disabled={pending}
        onClick={() =>
          run(async () => {
            const res = await paymentLink(id);
            if (res.ok && res.url) {
              setLink(res.url);
              await navigator.clipboard?.writeText(res.url).catch(() => undefined);
            }
            return res;
          })
        }
        className="min-h-9"
      >
        <Icon.link size={13} /> Payment link
      </Button>
      {link && (
        <Modal open onClose={() => setLink(null)} title="Payment link" hint="Copied. Anyone with it can see what's owed on this invoice and pay it.">
          <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-[12px]" />
        </Modal>
      )}
    </>
  );
}
