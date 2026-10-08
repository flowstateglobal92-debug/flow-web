"use client";

import { useRef, useState, type DragEvent } from "react";
import { Icon } from "@/components/admin/icons";
import { MAX_RECEIPT_BYTES, RECEIPT_ACCEPT, formatBytes, isReceiptType, type QueuedReceipt } from "./types";

/**
 * Drop receipts here or tap to pick. Files wait in the queue until the entry
 * is saved, then upload straight to Storage (./uploads) — each row shows its
 * progress, and a file that didn't make it stays with the reason.
 */
export default function ReceiptDrop({
  items,
  onAdd,
  onRemove,
  disabled,
}: {
  items: QueuedReceipt[];
  onAdd: (files: File[]) => void;
  onRemove: (key: string) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  const add = (list: FileList | null) => {
    const incoming = Array.from(list ?? []);
    const good = incoming.filter((f) => isReceiptType(f) && f.size <= MAX_RECEIPT_BYTES);
    const bad = incoming.filter((f) => !good.includes(f));
    setRejected(bad.length ? `${bad.map((f) => f.name).join(", ")} — PNG, JPEG, WebP, GIF, HEIC or PDF up to 10MB only.` : null);
    if (good.length) onAdd(good);
    if (input.current) input.current.value = "";
  };

  const drop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setOver(false);
    if (!disabled) add(e.dataTransfer.files);
  };

  return (
    <div>
      <input ref={input} type="file" multiple accept={RECEIPT_ACCEPT} className="hidden" onChange={(e) => add(e.target.files)} />
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={`flex min-h-[64px] w-full flex-col items-center justify-center gap-1 border border-dashed px-3 py-3 text-center transition-colors duration-300 disabled:opacity-50 ${
          over ? "border-terra/60 bg-terra/[0.08] text-cream" : "border-cream/15 bg-ink/40 text-sand hover:border-cream/30 hover:text-cream"
        }`}
      >
        <Icon.upload size={16} />
        <span className="text-[12px]">Drop receipts or tap to choose</span>
        <span className="text-[10.5px] text-sand/80">Photos or PDF · up to 10MB each</span>
      </button>

      {items.length > 0 && <ReceiptQueue items={items} onRemove={onRemove} disabled={disabled} className="mt-2" />}

      {rejected && <p className="mt-1.5 text-[11.5px] text-bad-200">{rejected}</p>}
    </div>
  );
}

/** The queue's rows: size while waiting, a thin fill and percent while uploading, the reason when it failed. */
export function ReceiptQueue({
  items,
  onRemove,
  disabled,
  className = "",
}: {
  items: QueuedReceipt[];
  onRemove: (key: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <ul className={`space-y-1.5 ${className}`}>
      {items.map((item) => {
        const uploading = item.status === "uploading";
        const failed = item.status === "failed";
        return (
          <li
            key={item.key}
            className={`relative border bg-ink/50 px-3 py-1.5 text-[12px] text-cream-2 ${failed ? "border-bad-400/30" : "border-cream/[0.08]"}`}
          >
            <div className="flex items-center gap-2">
              <Icon.paperclip size={12} />
              <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
              <span className={`shrink-0 font-mono text-[10.5px] tabular-nums ${failed ? "text-bad-200" : "text-sand"}`}>
                {uploading ? `${Math.round(item.progress * 100)}%` : failed ? "Failed" : formatBytes(item.file.size)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${item.file.name}`}
                disabled={disabled || uploading}
                onClick={() => onRemove(item.key)}
                className="flex h-7 w-7 shrink-0 items-center justify-center text-sand transition-colors hover:text-bad-200 disabled:opacity-40 pointer-coarse:h-9 pointer-coarse:w-9"
              >
                <Icon.close size={13} />
              </button>
            </div>
            {failed && item.error && <p className="mt-0.5 pl-5 text-[11px] leading-snug text-bad-200/90">{item.error}</p>}
            {uploading && (
              <span
                aria-hidden
                className="absolute bottom-0 left-0 h-px bg-terra-bright"
                style={{ width: `${Math.round(item.progress * 100)}%` }}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
