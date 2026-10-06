"use client";

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import Modal from "@/components/admin/Modal";
import { Icon } from "@/components/admin/icons";
import { Button } from "@/components/admin/ui";
import { formatDate } from "@/lib/admin/format";
import { receiptLink, type ReceiptLink } from "@/app/admin/actions/finance";
import { ReceiptQueue } from "./ReceiptDrop";
import { RECEIPT_ACCEPT, formatBytes, type QueuedReceipt, type Receipt } from "./types";

// Inline PDFs only where a PDF viewer reliably renders inside a frame (desktop
// browsers); phones get the Open / Download buttons.
const FINE_POINTER = "(pointer: fine)";
const subscribePointer = (onChange: () => void) => {
  const query = window.matchMedia(FINE_POINTER);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const finePointer = () => window.matchMedia(FINE_POINTER).matches;

/**
 * Image/PDF viewer for an entry's receipts. Each file is fetched through a
 * two-minute signed URL minted on open — nothing in the bucket is public.
 * Added files upload from the browser; `uploads` is their progress, and a
 * failed one stays listed with its reason until dismissed.
 */
export default function ReceiptViewer({
  title,
  receipts,
  start = 0,
  canEdit,
  pending,
  uploads = [],
  onClose,
  onDelete,
  onAdd,
  onDismissUpload,
  onError,
}: {
  title: string;
  receipts: Receipt[];
  start?: number;
  canEdit: boolean;
  pending: boolean;
  uploads?: QueuedReceipt[];
  onClose: () => void;
  onDelete: (receipt: Receipt) => void;
  onAdd: (files: File[]) => void;
  onDismissUpload?: (key: string) => void;
  /** Shown as the page's toast — a download that couldn't start. */
  onError?: (message: string) => void;
}) {
  const [index, setIndex] = useState(start);
  const input = useRef<HTMLInputElement>(null);
  const current = receipts[Math.min(index, receipts.length - 1)];

  return (
    <Modal open onClose={onClose} title="Receipts" hint={title} width="max-w-3xl">
      {receipts.length > 1 && (
        <div className="scroll-x -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {receipts.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setIndex(i)}
              className={`inline-flex min-h-9 max-w-[220px] shrink-0 items-center gap-1.5 border px-3 py-1.5 text-[12px] transition-colors duration-300 sm:min-h-0 ${
                r.id === current?.id
                  ? "border-terra/50 bg-terra/15 text-terra-bright"
                  : "border-cream/12 bg-cream/[0.03] text-cream-2 hover:border-cream/30 hover:text-cream"
              }`}
            >
              <Icon.paperclip size={12} />
              <span className="truncate">{r.file_name ?? "Receipt"}</span>
            </button>
          ))}
        </div>
      )}

      {current ? (
        <Preview
          key={current.id}
          receipt={current}
          canEdit={canEdit}
          pending={pending}
          onDelete={() => onDelete(current)}
          onError={onError}
        />
      ) : (
        <p className="py-10 text-center text-[12.5px] text-sand">No receipts on this entry yet.</p>
      )}

      {uploads.length > 0 && (
        <ReceiptQueue items={uploads} onRemove={(key) => onDismissUpload?.(key)} disabled={pending} className="mt-3" />
      )}

      {canEdit && (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-cream/[0.08] pt-3">
          <span className="text-[11px] text-sand">Photos or PDF · up to 10MB each</span>
          <input
            ref={input}
            type="file"
            multiple
            accept={RECEIPT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) onAdd(files);
              e.target.value = "";
            }}
          />
          <Button onClick={() => input.current?.click()} disabled={pending} className="min-h-9 sm:min-h-0">
            <Icon.upload size={13} /> Add receipt
          </Button>
        </div>
      )}
    </Modal>
  );
}

function Preview({
  receipt,
  canEdit,
  pending,
  onDelete,
  onError,
}: {
  receipt: Receipt;
  canEdit: boolean;
  pending: boolean;
  onDelete: () => void;
  onError?: (message: string) => void;
}) {
  const [link, setLink] = useState<ReceiptLink | null>(null);
  const [downloading, setDownloading] = useState(false);
  const report = useEffectEvent((message: string) => onError?.(message));

  useEffect(() => {
    let alive = true;
    // A call that never answers (offline, a deploy replaced the action) reads
    // as a failed link and a toast, not an endless "Fetching…".
    receiptLink(receipt.id)
      .catch((): ReceiptLink => {
        const error = "Couldn't reach the server — close and try again.";
        if (alive) report(error);
        return { ok: false, error };
      })
      .then((r) => {
        if (alive) setLink(r);
      });
    return () => {
      alive = false;
    };
  }, [receipt.id]);

  const isPdf = (receipt.mime_type ?? link?.mime ?? "").includes("pdf");
  const inlinePdf = useSyncExternalStore(subscribePointer, finePointer, () => false);
  const name = receipt.file_name ?? "Receipt";

  const download = async () => {
    setDownloading(true);
    try {
      const r = await receiptLink(receipt.id, true);
      // The signed URL answers with Content-Disposition: attachment, so this saves rather than navigates.
      if (r.ok && r.url) window.location.assign(r.url);
      else onError?.(r.error ?? "Couldn't prepare the download.");
    } catch {
      onError?.("Couldn't reach the server — try again.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <div className="flex min-h-[240px] items-center justify-center border border-cream/[0.08] bg-ink/60">
        {!link ? (
          <p className="text-[12px] text-sand">Fetching a secure link…</p>
        ) : !link.ok || !link.url ? (
          <p className="px-4 text-center text-[12px] text-rose-200">{link.error ?? "Couldn't open this receipt."}</p>
        ) : isPdf ? (
          // A frame, not <object>: the site CSP sends object-src 'none'. No sandbox —
          // Chrome won't run its PDF viewer in a sandboxed frame.
          inlinePdf ? (
            <iframe src={link.url} title={name} className="h-[60vh] w-full bg-white" />
          ) : (
            <p className="px-4 py-10 text-center text-[12px] text-sand">PDF receipt — use Open or Download below.</p>
          )
        ) : (
          // Signed, short-lived and cross-origin — next/image would cache it past its expiry.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={link.url} alt={name} className="block max-h-[60vh] w-auto max-w-full object-contain" />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] text-cream">{name}</p>
          <p className="font-mono text-[10.5px] tabular-nums text-sand">
            {formatBytes(receipt.size_bytes)} · added {formatDate(receipt.created_at)}
          </p>
        </div>
        {link?.ok && link.url && (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center gap-1.5 border border-cream/12 bg-cream/[0.03] px-3 py-1.5 text-[12px] font-medium text-cream-2 transition-colors duration-300 hover:border-cream/30 hover:text-cream sm:min-h-0"
          >
            <Icon.eye size={13} /> Open
          </a>
        )}
        <Button onClick={download} disabled={downloading} className="min-h-9 sm:min-h-0">
          <Icon.download size={13} /> {downloading ? "Preparing…" : "Download"}
        </Button>
        {canEdit && (
          <Button
            variant="danger"
            disabled={pending}
            className="min-h-9 sm:min-h-0"
            onClick={() => {
              if (confirm(`Remove ${name}? The file is deleted for good.`)) onDelete();
            }}
          >
            <Icon.trash size={13} /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}
