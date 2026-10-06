import type { TeamMember } from "@/lib/admin/types";
import { displayName } from "@/lib/admin/format";

/**
 * Plain helpers shared by the comment thread, the mention box, the comment
 * actions and the notification surfaces. No React and no server-only imports,
 * so both sides of the wire can use them.
 */

export type CommentTarget = { type: "lead" | "client" | "invoice" | "todo"; id: string };

export type CommentRow = {
  id: string;
  author_id: string | null;
  body: string;
  mentions: string[];
  created_at: string;
  edited_at: string | null;
};

/** What listComments() hands the thread: rows plus names for every author and mention. */
export type CommentFeed = {
  ok: boolean;
  error?: string;
  me: string | null;
  comments: CommentRow[];
  names: Record<string, string>;
};

/** The one display-name rule (lib/admin/format), under the name this module has always exported. */
export const personName = displayName;

const isWordChar = (c: string | undefined) => !!c && /[A-Za-z0-9_]/.test(c);

/**
 * Walks `text` and calls `hit` for every "@Name" that matches one of `names`
 * (case-insensitive, whole word). Longest names are tried first so "@Ana Silva"
 * wins over "@Ana".
 */
function scan(text: string, names: string[], hit: (start: number, end: number, index: number) => void) {
  const order = names
    .map((name, index) => ({ name: name.toLowerCase(), index }))
    .filter((n) => n.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length);
  const lower = text.toLowerCase();

  let i = lower.indexOf("@");
  while (i !== -1) {
    let end = -1;
    if (!isWordChar(text[i - 1])) {
      for (const n of order) {
        const stop = i + 1 + n.name.length;
        if (lower.startsWith(n.name, i + 1) && !isWordChar(text[stop])) {
          hit(i, stop, n.index);
          end = stop;
          break;
        }
      }
    }
    i = lower.indexOf("@", end === -1 ? i + 1 : end);
  }
}

/** Ids of the people whose "@Name" appears in `text`. */
export function mentionedIds(text: string, people: Pick<TeamMember, "id" | "full_name" | "email">[]) {
  const found = new Set<string>();
  scan(
    text,
    people.map((p) => personName(p)),
    (_s, _e, index) => found.add(people[index].id),
  );
  return [...found];
}

/** A comment body cut into plain runs and @mention runs, for highlighting. */
export function splitMentions(body: string, names: string[]) {
  const parts: { text: string; mention: boolean }[] = [];
  let at = 0;
  scan(body, names, (start, end) => {
    if (start > at) parts.push({ text: body.slice(at, start), mention: false });
    parts.push({ text: body.slice(start, end), mention: true });
    at = end;
  });
  if (at < body.length) parts.push({ text: body.slice(at), mention: false });
  return parts;
}
