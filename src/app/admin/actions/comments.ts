"use server";

import { authorizeUser } from "@/lib/admin/auth";
import { personName, type CommentFeed, type CommentRow, type CommentTarget } from "@/components/admin/comments/mentions";
import { fail, mustAffect, ok, type ActionResult } from "./shared";

/**
 * Comments on a lead, client, invoice or to-do. Every rule lives in RLS
 * (0021): you see a comment when you can see its parent, anyone who can see
 * the parent may comment, and only the author edits or deletes. Mentions are
 * re-filtered by the database to people who can open the parent, and the
 * notifications fan out from its triggers — nothing here sends alerts.
 */

const COLUMN: Record<CommentTarget["type"], string> = {
  lead: "lead_id",
  client: "client_id",
  invoice: "invoice_id",
  todo: "todo_id",
};

const COLUMNS = "id, author_id, body, mentions, created_at, edited_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 5000;

function columnFor(target: CommentTarget) {
  const column = COLUMN[target?.type];
  if (!column || !UUID.test(String(target?.id ?? ""))) throw new Error("That item can't take comments.");
  return column;
}

/** Ids the client claims were mentioned — shape-checked here, access-checked by the database. */
const cleanMentions = (ids: unknown) =>
  Array.isArray(ids) ? [...new Set(ids.map(String).filter((id) => UUID.test(id)))].slice(0, 25) : [];

function cleanBody(body: unknown) {
  const value = String(body ?? "").trim();
  if (!value) throw new Error("Write something first.");
  if (value.length > MAX_BODY) throw new Error(`Keep it under ${MAX_BODY.toLocaleString("en-LK")} characters.`);
  return value;
}

/** A table or column the migration hasn't created yet. */
const missing = (error: { code?: string } | null) =>
  !!error && ["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? "");

export async function listComments(target: CommentTarget): Promise<CommentFeed> {
  try {
    const { supabase, profile } = await authorizeUser();
    const column = columnFor(target);

    const { data, error } = await supabase
      .from("comments")
      .select(COLUMNS)
      .eq(column, target.id)
      .order("created_at", { ascending: true })
      .limit(300)
      .returns<CommentRow[]>();
    if (missing(error)) return { ok: false, error: "Comments aren't available yet.", me: profile.id, comments: [], names: {} };
    if (error) throw error;

    const comments = (data ?? []).map((c) => ({ ...c, mentions: c.mentions ?? [] }));

    // Names for authors and everyone mentioned — the thread's `people` is
    // filtered to who can be tagged now, which can miss an older author.
    const ids = [...new Set(comments.flatMap((c) => [c.author_id, ...c.mentions]).filter((id): id is string => !!id))];
    let names: Record<string, string> = {};
    if (ids.length) {
      const { data: people } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids)
        .returns<{ id: string; full_name: string | null; email: string }[]>();
      names = Object.fromEntries((people ?? []).map((p) => [p.id, personName(p)]));
    }

    return { ok: true, me: profile.id, comments, names };
  } catch (e) {
    return { ...fail(e), me: null, comments: [], names: {} };
  }
}

export async function postComment(target: CommentTarget, body: string, mentions: string[]): Promise<ActionResult> {
  try {
    const { supabase } = await authorizeUser();
    const column = columnFor(target);

    // author_id is stamped by the database from the session.
    const { data, error } = await supabase
      .from("comments")
      .insert({ [column]: target.id, body: cleanBody(body), mentions: cleanMentions(mentions) })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;
    return ok("Comment posted.", data.id);
  } catch (e) {
    return fail(e);
  }
}

export async function editComment(id: string, body: string, mentions: string[]): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorizeUser();
    if (!UUID.test(String(id))) throw new Error("That comment no longer exists.");

    const { data, error } = await supabase
      .from("comments")
      .update({ body: cleanBody(body), mentions: cleanMentions(mentions), edited_at: new Date().toISOString() })
      .eq("id", id)
      .eq("author_id", profile.id)
      .select("id");
    if (error) throw error;
    mustAffect(data, "You can only edit your own comments.");
    return ok("Comment updated.", id);
  } catch (e) {
    return fail(e);
  }
}

export async function deleteComment(id: string): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorizeUser();
    if (!UUID.test(String(id))) throw new Error("That comment no longer exists.");

    const { data, error } = await supabase
      .from("comments")
      .delete()
      .eq("id", id)
      .eq("author_id", profile.id)
      .select("id");
    if (error) throw error;
    mustAffect(data, "You can only delete your own comments.");
    return ok("Comment deleted.");
  } catch (e) {
    return fail(e);
  }
}
