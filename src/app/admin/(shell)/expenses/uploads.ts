import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import { recordReceipt } from "@/app/admin/actions/finance";
import { MAX_RECEIPT_BYTES, RECEIPT_BUCKET, receiptType, type QueuedReceipt } from "./types";

/**
 * Receipts go from the browser straight to Storage, never through a Server
 * Action body — Netlify caps a function request near 6MB, under one phone
 * photo. Each file uploads with the person's own session, so the bucket's
 * policies (0017/0027) check the workspace folder, Expenses access and room
 * on the entry; recordReceipt then files it and re-checks what arrived.
 */

const safeName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(-80) || "receipt";

/**
 * What Storage said, as a sentence the person can act on. A policy refusal
 * comes back as HTTP 400 with statusCode "403" in the body.
 */
function refusal(status: number, body: string) {
  let message = body;
  let code = String(status);
  try {
    const parsed = JSON.parse(body) as { message?: unknown; statusCode?: unknown };
    message = String(parsed.message ?? "");
    code = String(parsed.statusCode ?? status);
  } catch {
    // not JSON — keep the raw text
  }
  if (code === "413" || /maximum allowed size|too large/i.test(message)) return "It's over the 10MB limit.";
  if (code === "415" || /mime type/i.test(message)) return "That type isn't taken — PNG, JPEG, WebP, GIF, HEIC or PDF.";
  if (code === "403" || /row-level security/i.test(message)) {
    return "Storage refused it — an entry holds up to 25 receipts (the demo workspace, 50 in all).";
  }
  return message || `The upload failed (${status || "no answer"}).`;
}

/** One file to `path`, reporting progress — fetch can't report upload progress, XHR can. */
async function put(path: string, file: File, type: string, onProgress: (fraction: number) => void) {
  const { data } = await createClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has ended — sign in again, then retry.");

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    // storage-js's request for a raw body (no upsert by default). Raw rather
    // than multipart so the type is the one chosen here, not the browser's
    // guess — which is nothing at all for HEIC on most desktops.
    xhr.open("POST", `${SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/${RECEIPT_BUCKET}/${path}`);
    xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", SUPABASE_KEY);
    xhr.setRequestHeader("content-type", type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(refusal(xhr.status, xhr.responseText))));
    xhr.onerror = () => reject(new Error("The connection dropped — try again."));
    xhr.onabort = () => reject(new Error("The upload was cancelled."));
    xhr.send(file);
  });
}

export type UploadOutcome = { attached: number; failed: { name: string; error: string }[] };

/** "2 receipts attached." / "1 of 3 receipts attached — <first reason>" */
export function describeUploads(outcome: UploadOutcome) {
  const total = outcome.attached + outcome.failed.length;
  if (!outcome.failed.length) return outcome.attached === 1 ? "Receipt attached." : `${outcome.attached} receipts attached.`;
  const first = outcome.failed[0];
  return `${outcome.attached} of ${total} receipt${total === 1 ? "" : "s"} attached — ${first.name}: ${first.error}`;
}

const queued = (file: File): QueuedReceipt => ({ key: crypto.randomUUID(), file, status: "waiting", progress: 0 });

/**
 * A queue of picked receipts and the upload that empties it. Files go one at
 * a time (the bucket counts an entry's files per request, and a phone's
 * uplink is better spent on one). A file that fails stays queued with its
 * reason; sending again retries only those.
 */
export function useReceiptUploads() {
  const [items, setItems] = useState<QueuedReceipt[]>([]);

  const patch = useCallback(
    (key: string, next: Partial<QueuedReceipt>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...next } : i))),
    [],
  );

  const add = useCallback((files: File[]) => {
    const next = files.map(queued);
    setItems((list) => [...list, ...next]);
    return next;
  }, []);
  const remove = useCallback((key: string) => setItems((list) => list.filter((i) => i.key !== key)), []);
  const clear = useCallback(() => setItems([]), []);

  const send = useCallback(
    async (entryId: string, workspace: string, list: QueuedReceipt[]): Promise<UploadOutcome> => {
      const outcome: UploadOutcome = { attached: 0, failed: [] };
      for (const item of list) {
        const { file } = item;
        const fail = (error: string) => {
          outcome.failed.push({ name: file.name, error });
          patch(item.key, { status: "failed", progress: 0, error });
        };
        const type = receiptType(file);
        if (!type || file.size > MAX_RECEIPT_BYTES) {
          fail("Only PNG, JPEG, WebP, GIF, HEIC or PDF, up to 10MB.");
          continue;
        }

        const path = `${workspace}/${entryId}/${crypto.randomUUID().slice(0, 8)}-${safeName(file.name)}`;
        patch(item.key, { status: "uploading", progress: 0, error: undefined });
        try {
          await put(path, file, type, (progress) => patch(item.key, { progress }));
        } catch (e) {
          fail(e instanceof Error ? e.message : "The upload failed.");
          continue;
        }

        let filed: { ok: boolean; error?: string };
        try {
          filed = await recordReceipt(entryId, path, file.name);
        } catch {
          filed = { ok: false, error: "Couldn't reach the server — try again." };
        }
        if (!filed.ok) {
          // Take the file back rather than leave it in the folder unlisted, where
          // it would still count towards the entry's cap. (The action removes
          // what it refuses too; a second remove of a gone file is a no-op.)
          await createClient()
            .storage.from(RECEIPT_BUCKET)
            .remove([path])
            .catch(() => null);
          fail(filed.error ?? "It couldn't be attached.");
          continue;
        }
        outcome.attached++;
        setItems((all) => all.filter((i) => i.key !== item.key));
      }
      return outcome;
    },
    [patch],
  );

  return { items, add, remove, clear, send };
}
