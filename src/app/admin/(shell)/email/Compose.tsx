"use client";

import { useRef, useState } from "react";
import Modal from "@/components/admin/Modal";
import { Icon } from "@/components/admin/icons";
import { Button, Field, Input, Textarea } from "@/components/admin/ui";
import { formatBytes, MAX_ATTACHMENT_BYTES } from "@/lib/email/types";
import { sendMail } from "@/app/admin/actions/email";

export type Draft = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  /** Message-ID of what's being answered — this is what keeps the thread intact. */
  inReplyTo?: string;
};

export const emptyDraft: Draft = { to: "", cc: "", bcc: "", subject: "", body: "" };

/**
 * Compose / reply / forward window.
 *
 * Files are handed to the Server Action as real `File`s inside the FormData —
 * Next streams the multipart body straight through, so nothing has to be
 * base64-encoded in the browser.
 */
export default function Compose({
  open,
  draft,
  from,
  pending,
  onClose,
  onChange,
  onSend,
}: {
  open: boolean;
  draft: Draft;
  from: string;
  pending: boolean;
  onClose: () => void;
  onChange: (patch: Partial<Draft>) => void;
  onSend: (send: () => Promise<{ ok: boolean; error?: string; message?: string }>) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [extras, setExtras] = useState(false);

  const total = files.reduce((sum, f) => sum + f.size, 0);
  const tooBig = total > MAX_ATTACHMENT_BYTES;

  const close = () => {
    setFiles([]);
    setExtras(false);
    if (fileInput.current) fileInput.current.value = "";
    onClose();
  };

  const submit = () => {
    const data = new FormData();
    data.set("to", draft.to);
    data.set("cc", draft.cc);
    data.set("bcc", draft.bcc);
    data.set("subject", draft.subject);
    data.set("body", draft.body);
    if (draft.inReplyTo) data.set("inReplyTo", draft.inReplyTo);
    for (const file of files) data.append("attachments", file);

    onSend(async () => {
      const result = await sendMail(data);
      if (result.ok) close();
      return result;
    });
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={draft.inReplyTo ? "Reply" : "New message"}
      hint={`From ${from}`}
      width="max-w-2xl"
      footer={
        <>
          <span className="mr-auto text-[11px] text-sand">
            {files.length > 0
              ? `${files.length} file${files.length === 1 ? "" : "s"} · ${formatBytes(total)}`
              : "Attachments up to 20MB"}
          </span>
          <Button onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending || tooBig}>
            <Icon.send size={13} /> {pending ? "Sending…" : "Send"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="To" hint="Separate several addresses with commas.">
          <Input
            value={draft.to}
            onChange={(e) => onChange({ to: e.target.value })}
            placeholder="name@company.com"
            type="text"
            autoComplete="off"
          />
        </Field>

        {extras ? (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Cc">
              <Input value={draft.cc} onChange={(e) => onChange({ cc: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="Bcc">
              <Input value={draft.bcc} onChange={(e) => onChange({ bcc: e.target.value })} autoComplete="off" />
            </Field>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setExtras(true)}
            className="text-[11.5px] text-sand transition-colors hover:text-cream"
          >
            + Add Cc / Bcc
          </button>
        )}

        <Field label="Subject">
          <Input value={draft.subject} onChange={(e) => onChange({ subject: e.target.value })} />
        </Field>

        <Field label="Message">
          <Textarea rows={11} value={draft.body} onChange={(e) => onChange({ body: e.target.value })} />
        </Field>

        <div>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])}
          />
          <Button onClick={() => fileInput.current?.click()} disabled={pending}>
            <Icon.paperclip size={13} /> Attach files
          </Button>

          {files.length > 0 && (
            <ul className="mt-2.5 space-y-1.5">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-2 border border-cream/[0.08] bg-ink/50 px-3 py-1.5 text-[12px] text-cream-2"
                >
                  <Icon.paperclip size={12} />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-sand tabular-nums">
                    {formatBytes(file.size)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                    className="shrink-0 text-sand transition-colors hover:text-rose-200"
                  >
                    <Icon.close size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {tooBig && (
            <p className="mt-2 text-[11.5px] text-rose-200">
              That&apos;s {formatBytes(total)} — trim it to 20MB or send a link instead.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
