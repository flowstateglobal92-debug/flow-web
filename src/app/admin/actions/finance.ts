"use server";

import { revalidatePath } from "next/cache";
import { authorize, type Session } from "@/lib/admin/auth";
import { money, todayISO } from "@/lib/admin/format";
import type { FinanceKind } from "@/lib/admin/types";
import { MAX_RECEIPT_BYTES, RECEIPT_BUCKET, isAllowedReceiptType } from "@/app/admin/(shell)/expenses/types";
import { amount, fail, mustAffect, ok, optional, text, type ActionResult } from "./shared";

/** The private bucket (0017): `<workspace>/<entry_id>/<file>`. */
const BUCKET = RECEIPT_BUCKET;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readEntry(formData: FormData) {
  const kind = (text(formData, "kind") || "expense") as FinanceKind;
  const value = Math.abs(amount(formData, "amount"));
  return {
    kind,
    entry_date: text(formData, "entry_date") || todayISO(),
    description: text(formData, "description"),
    category: text(formData, "category") || "General",
    // Stored positive; the generated `signed_amount` column applies the sign,
    // so a month of expenses with no income sums to a negative profit.
    amount: value,
    method: optional(formData, "method"),
    reference: optional(formData, "reference"),
  };
}

function refresh() {
  revalidatePath("/admin/expenses");
  revalidatePath("/admin/expenses/budgets");
  revalidatePath("/admin/approvals");
  revalidatePath("/admin/reports");
  revalidatePath("/admin");
}

/**
 * Payment rows belong to their invoice — the database refuses direct edits,
 * this just says so in a sentence before trying.
 */
async function assertEditable(supabase: Session["supabase"], id: string) {
  const { data } = await supabase
    .from("finance_entries")
    .select("id, invoice_payment_id, reference")
    .eq("id", id)
    .maybeSingle<{ id: string; invoice_payment_id: string | null; reference: string | null }>();
  if (data?.invoice_payment_id) {
    throw new Error(`This income belongs to ${data.reference ?? "an invoice"} — change it from Invoices.`);
  }
}

/**
 * Saves the entry only. Receipts go from the browser straight to Storage once
 * this returns the id (a Server Action body is capped well under a 10MB
 * photo on Netlify), then each is filed with recordReceipt.
 */
export async function createEntry(formData: FormData): Promise<ActionResult> {
  try {
    const { supabase, user } = await authorize("finance");
    const entry = readEntry(formData);
    if (!entry.description) return { ok: false, error: "Describe the entry." };
    if (!(entry.amount > 0)) return { ok: false, error: "Amount must be greater than zero." };

    const { data, error } = await supabase
      .from("finance_entries")
      .insert({ ...entry, created_by: user.id })
      .select("*")
      .single<{ id: string; approval_status?: string }>();
    if (error) throw error;
    refresh();

    // Members over the threshold land as pending (0016) — say so, since it won't count yet.
    const message =
      data.approval_status === "pending"
        ? `${entry.kind === "income" ? "Income" : "Expense"} of ${money(entry.amount)} recorded — waiting for approval.`
        : entry.kind === "income"
          ? "Income recorded."
          : "Expense recorded.";
    return ok(message, data.id);
  } catch (e) {
    return fail(e);
  }
}

export async function updateEntry(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const entry = readEntry(formData);
    if (!entry.description) return { ok: false, error: "Describe the entry." };
    if (!(entry.amount > 0)) return { ok: false, error: "Amount must be greater than zero." };
    await assertEditable(supabase, id);

    const { data, error } = await supabase
      .from("finance_entries")
      .update(entry)
      .eq("id", id)
      .select("*")
      .returns<{ id: string; approval_status?: string }[]>();
    if (error) throw error;
    mustAffect(data);
    refresh();
    return ok(data[0].approval_status === "pending" ? "Entry updated — waiting for approval." : "Entry updated.", id);
  } catch (e) {
    return fail(e);
  }
}

export async function deleteEntry(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    await assertEditable(supabase, id);

    // Read the receipt paths first — the rows cascade away with the entry.
    const { data: files } = await supabase
      .from("finance_attachments")
      .select("storage_path")
      .eq("entry_id", id)
      .returns<{ storage_path: string }[]>();

    const { data, error } = await supabase.from("finance_entries").delete().eq("id", id).select("id");
    if (error) throw error;
    mustAffect(data);

    // Entry first, objects second: a failed delete never leaves a row pointing at nothing.
    const paths = (files ?? []).map((f) => f.storage_path);
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);

    refresh();
    return ok("Entry deleted.");
  } catch (e) {
    return fail(e);
  }
}

/**
 * File a receipt the browser has just uploaded. Only an object in the
 * caller's own workspace, in this entry's folder, one level down, is
 * accepted — and its size and type are read back from Storage, not taken
 * from the browser. Anything that doesn't pass is removed again, so a
 * refused file never lingers unlisted.
 *
 * No revalidatePath: a batch calls this once per file and refreshes the
 * page itself when the last one lands.
 */
export async function recordReceipt(entryId: string, path: string, fileName: string): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorize("finance");
    const folder = `${profile.workspace}/${entryId}/`;
    if (!UUID.test(entryId) || !path.startsWith(folder) || !/^[\w.-]{1,160}$/.test(path.slice(folder.length))) {
      return { ok: false, error: "That upload isn't in this entry's folder." };
    }
    const bucket = supabase.storage.from(BUCKET);
    const discard = () => bucket.remove([path]);

    // RLS decides: an entry this person can't see (or that was just deleted) takes no receipts.
    const { data: entry, error: entryError } = await supabase
      .from("finance_entries")
      .select("id")
      .eq("id", entryId)
      .maybeSingle<{ id: string }>();
    if (entryError) throw entryError;
    if (!entry) {
      await discard();
      return { ok: false, error: "That entry is gone." };
    }

    const { data: info, error: infoError } = await bucket.info(path);
    if (infoError || !info) return { ok: false, error: "The upload didn't arrive — try again." };
    const size = Number(info.size ?? info.metadata?.size);
    const type = info.contentType ?? info.metadata?.mimetype ?? null;
    if (!isAllowedReceiptType(type) || !(size >= 0 && size <= MAX_RECEIPT_BYTES)) {
      await discard();
      return { ok: false, error: "Receipts are PNG, JPEG, WebP, GIF, HEIC or PDF, up to 10MB." };
    }

    const name = fileName.trim().slice(0, 200) || (path.split("/").pop() ?? "receipt");
    const { error } = await supabase.from("finance_attachments").insert({
      entry_id: entryId,
      storage_path: path,
      file_name: name,
      mime_type: type,
      size_bytes: size,
    });
    if (error) {
      // A retry of one that was already filed: its row is there, keep the file.
      if (error.code === "23505") return ok("Receipt attached.", entryId);
      await discard();
      throw error;
    }
    return ok("Receipt attached.", entryId);
  } catch (e) {
    return fail(e);
  }
}

export async function deleteReceipt(attachmentId: string): Promise<ActionResult> {
  try {
    const { supabase } = await authorize("finance");
    const { data, error } = await supabase
      .from("finance_attachments")
      .delete()
      .eq("id", attachmentId)
      .select("id, storage_path")
      .returns<{ id: string; storage_path: string }[]>();
    if (error) throw error;
    mustAffect(data);
    await supabase.storage.from(BUCKET).remove([data[0].storage_path]);
    refresh();
    return ok("Receipt removed.");
  } catch (e) {
    return fail(e);
  }
}

export type ReceiptLink = { ok: boolean; error?: string; url?: string; name?: string; mime?: string | null };

/** A two-minute signed URL — the bucket is private, so links never outlive the visit. */
export async function receiptLink(attachmentId: string, download = false): Promise<ReceiptLink> {
  try {
    const { supabase } = await authorize("finance");
    const { data: row, error } = await supabase
      .from("finance_attachments")
      .select("storage_path, file_name, mime_type")
      .eq("id", attachmentId)
      .maybeSingle<{ storage_path: string; file_name: string | null; mime_type: string | null }>();
    if (error) throw error;
    if (!row) return { ok: false, error: "That receipt is gone." };

    const name = row.file_name || row.storage_path.split("/").pop() || "receipt";
    const { data, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.storage_path, 120, download ? { download: name } : undefined);
    if (signErr) throw signErr;
    return { ok: true, url: data.signedUrl, name, mime: row.mime_type };
  } catch (e) {
    const r = fail(e);
    return { ok: false, error: r.error };
  }
}
