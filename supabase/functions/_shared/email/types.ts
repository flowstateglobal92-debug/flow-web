// GENERATED from src/lib/email/types.ts by scripts/sync-edge-shared.mjs — edit the source, not this copy.
/**
 * Shapes the mailbox UI works in, flattened from Resend's two different
 * message payloads (inbound `GET /emails/receiving`, outbound `GET /emails`)
 * so the list and the reading pane only ever deal with one type.
 */

export type MailDirection = "inbound" | "outbound";

export type MailFolder = "inbox" | "starred" | "archive" | "sent" | "trash";

export type MailFlags = {
  read: boolean;
  starred: boolean;
  archived: boolean;
  trashed: boolean;
};

export type MailAddress = {
  /** Display name if the header carried one, otherwise the local part. */
  name: string;
  address: string;
};

export type MailAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  /** Inline images referenced by the HTML body — hidden from the attachment row. */
  inline: boolean;
};

export type MailSummary = {
  id: string;
  direction: MailDirection;
  from: MailAddress;
  to: string[];
  cc: string[];
  subject: string;
  date: string;
  attachments: number;
  flags: MailFlags;
  /** Delivery state for sent mail — `delivered`, `bounced`, `queued`… */
  status?: string;
};

export type MailDetail = MailSummary & {
  bcc: string[];
  replyTo: string[];
  messageId: string | null;
  html: string | null;
  text: string | null;
  attachmentList: MailAttachment[];
};

/** Points at one message on either side of the mailbox. */
export type MailRef = { id: string; direction: MailDirection };

export type MailPage = {
  items: MailSummary[];
  hasMore: boolean;
  /** Cursor to pass back as `after` for the next page of older mail. */
  nextCursor: string | null;
  /** One side of the mailbox failed — e.g. receiving not enabled yet. */
  warnings: string[];
};

export const FOLDERS: { key: MailFolder; label: string }[] = [
  { key: "inbox", label: "Inbox" },
  { key: "starred", label: "Starred" },
  { key: "sent", label: "Sent" },
  { key: "archive", label: "Archive" },
  { key: "trash", label: "Trash" },
];

/** Max total size of one send's attachments before base64 — Resend caps at 40MB encoded. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * A message the app sends on its own (a document, statement or reminder) —
 * as opposed to one typed in the mailbox's Compose. `about` names the record
 * so the desktop's mail function can check the sender may open it.
 */
export type OutgoingMessage = {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  attachments?: { filename: string; content: Uint8Array; contentType: string }[];
  about: { module: "invoices" | "clients"; invoiceId?: string | null; clientId?: string | null };
};

export type SentMessage = { id: string; to: string[]; cc: string[] };
