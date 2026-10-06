import type { FinanceEntry } from "@/lib/admin/types";

/** A file in the private `receipts` bucket (0017). */
export type Receipt = {
  id: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

/** A ledger row plus what 0013/0016/0017 hang off it — every extra is optional until those run. */
export type LedgerEntry = FinanceEntry & {
  approval_note?: string | null;
  lead_id?: string | null;
  created_by?: string | null;
  finance_attachments?: Receipt[];
};

/** Private bucket from 0017; objects live at `<workspace>/<entry_id>/<file>`. */
export const RECEIPT_BUCKET = "receipts";
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

/** Exactly the bucket's allowed list (0027) — named types, so no SVG, which can carry script. */
export const RECEIPT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;
export type ReceiptType = (typeof RECEIPT_TYPES)[number];

// The extensions too: pickers that don't know HEIC's type would grey those photos out.
export const RECEIPT_ACCEPT = [...RECEIPT_TYPES, ".heic", ".heif"].join(",");

export const isAllowedReceiptType = (type: string | null | undefined): type is ReceiptType =>
  (RECEIPT_TYPES as readonly string[]).includes(type ?? "");

const BY_EXTENSION: Record<string, ReceiptType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
};

/**
 * The type a file uploads as, or null when the bucket would refuse it. Most
 * desktop browsers report no type for HEIC, and some say image/jpg — those
 * go by their extension. Anything else that names a type keeps it.
 */
export function receiptType(file: { name: string; type: string }): ReceiptType | null {
  const type = file.type.toLowerCase();
  if (isAllowedReceiptType(type)) return type;
  const unnamed = !type || type === "application/octet-stream" || (type.startsWith("image/") && !type.includes("svg"));
  return unnamed ? (BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? null) : null;
}

export const isReceiptType = (file: File) => receiptType(file) !== null;

/** A picked receipt on its way to Storage. Attached ones leave the queue; failed ones keep their reason. */
export type QueuedReceipt = {
  key: string;
  file: File;
  status: "waiting" | "uploading" | "failed";
  /** 0–1, while uploading. */
  progress: number;
  error?: string;
};

export function formatBytes(bytes: number | null | undefined) {
  const b = Number(bytes ?? 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
