"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { Avatar, Button } from "../ui";
import { useAction } from "../useAction";
import MentionInput from "./MentionInput";
import { personName, splitMentions, type CommentFeed, type CommentRow, type CommentTarget } from "./mentions";
import { deleteComment, editComment, listComments, postComment } from "@/app/admin/actions/comments";
import { relativeTime } from "@/lib/admin/format";
import type { TeamMember } from "@/lib/admin/types";

export type { CommentTarget } from "./mentions";

/**
 * Discussion on a lead, client, invoice or to-do, with @mentions.
 *
 * CONTRACT (the CRM lead modal, client profile, invoice drawer and to-do
 * drawer render it):
 *   <CommentThread target={{ type, id }} people={TeamMember[]} compact? />
 * It loads and posts through actions/comments.ts itself. `people` is who may
 * be mentioned here; the database re-filters mentions and sends the alerts.
 */

type Draft = { body: string; mentions: string[] };
const EMPTY: Draft = { body: "", mentions: [] };

export default function CommentThread({
  target,
  people,
  compact = false,
}: {
  target: CommentTarget;
  people: TeamMember[];
  compact?: boolean;
}) {
  const { run, pending, toast } = useAction();
  const key = `${target.type}:${target.id}`;
  const [feed, setFeed] = useState<(CommentFeed & { key: string }) | null>(null);
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<(Draft & { id: string }) | null>(null);

  // A different record in the same drawer starts with a clean box.
  const [shownKey, setShownKey] = useState(key);
  if (shownKey !== key) {
    setShownKey(key);
    setDraft(EMPTY);
    setEditing(null);
  }

  useEffect(() => {
    let live = true;
    const loaded = `${target.type}:${target.id}`;
    listComments({ type: target.type, id: target.id })
      .then((result) => {
        if (live) setFeed({ ...result, key: loaded });
      })
      .catch(() => {
        if (live) setFeed({ ok: false, error: "Couldn't load comments.", me: null, comments: [], names: {}, key: loaded });
      });
    return () => {
      live = false;
    };
  }, [target.type, target.id, version]);

  const current = feed?.key === key ? feed : null;
  const me = current?.me ?? null;
  const reload = () => setVersion((v) => v + 1);

  const nameFor = useMemo(() => {
    const byId = new Map(people.map((p) => [p.id, personName(p)]));
    return (id: string | null) => (id ? (byId.get(id) ?? current?.names[id] ?? null) : null);
  }, [people, current]);

  // You can't mention yourself — the alert would never be sent anyway.
  const mentionable = useMemo(() => people.filter((p) => p.id !== me && p.is_active), [people, me]);

  const send = () => {
    if (pending || !draft.body.trim()) return;
    const { body, mentions } = draft;
    run(() => postComment(target, body, mentions), {
      quiet: true,
      onDone: (r) => {
        if (!r.ok) return;
        setDraft(EMPTY);
        reload();
      },
    });
  };

  const saveEdit = () => {
    if (!editing || pending || !editing.body.trim()) return;
    const { id, body, mentions } = editing;
    run(() => editComment(id, body, mentions), {
      quiet: true,
      onDone: (r) => {
        if (!r.ok) return;
        setEditing(null);
        reload();
      },
    });
  };

  const remove = (c: CommentRow) => {
    if (!confirm("Delete this comment?")) return;
    run(() => deleteComment(c.id), { quiet: true, onDone: (r) => r.ok && reload() });
  };

  const avatar = compact ? 24 : 28;
  const comments = current?.comments ?? [];

  return (
    <div className={`flex flex-col ${compact ? "gap-3" : "gap-4"}`}>
      {!current ? (
        <p className="text-[12px] text-sand">Loading comments…</p>
      ) : current.error ? (
        <p className="text-[12px] text-sand">{current.error}</p>
      ) : comments.length === 0 ? (
        <p className="text-[12px] text-sand">No comments yet. Type @ to bring someone into the conversation.</p>
      ) : (
        <ul className={`flex flex-col ${compact ? "gap-3" : "gap-4"}`}>
          {comments.map((c) => {
            const author = nameFor(c.author_id) ?? "Former teammate";
            const mine = !!me && c.author_id === me;
            const isEditing = editing?.id === c.id;
            const mentioned = c.mentions.map((id) => nameFor(id)).filter((n): n is string => !!n);
            return (
              <li key={c.id} className="flex min-w-0 gap-3">
                <Avatar name={author} size={avatar} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-h-9 flex-wrap items-center gap-x-2 sm:min-h-0">
                    <span className="text-[12.5px] font-medium text-cream">{author}</span>
                    <span className="font-mono text-[10px] text-sand/80" suppressHydrationWarning>
                      {relativeTime(c.created_at)}
                      {c.edited_at ? " · edited" : ""}
                    </span>
                    {mine && !isEditing && (
                      <span className="ml-auto flex items-center">
                        <button
                          type="button"
                          onClick={() => setEditing({ id: c.id, body: c.body, mentions: c.mentions })}
                          aria-label="Edit comment"
                          title="Edit"
                          className="flex h-9 w-9 items-center justify-center text-sand transition-colors hover:text-cream sm:h-6 sm:w-6"
                        >
                          <Icon.edit size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(c)}
                          disabled={pending}
                          aria-label="Delete comment"
                          title="Delete"
                          className="flex h-9 w-9 items-center justify-center text-sand transition-colors hover:text-bad-200 sm:h-6 sm:w-6"
                        >
                          <Icon.trash size={13} />
                        </button>
                      </span>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="mt-1.5 flex flex-col gap-2">
                      <MentionInput
                        value={editing.body}
                        onChange={(body, mentions) => setEditing({ ...editing, body, mentions })}
                        people={mentionable}
                        rows={3}
                        onSubmit={saveEdit}
                        autoFocus
                        label="Edit comment"
                      />
                      <div className="flex justify-end gap-2">
                        <Button onClick={() => setEditing(null)} className="min-h-9 sm:min-h-0">
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          onClick={saveEdit}
                          disabled={pending || !editing.body.trim()}
                          className="min-h-9 sm:min-h-0"
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-cream-2">
                      {splitMentions(c.body, mentioned).map((part, i) =>
                        part.mention ? (
                          <span key={i} className="font-medium text-terra-bright">
                            {part.text}
                          </span>
                        ) : (
                          <span key={i}>{part.text}</span>
                        ),
                      )}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!current?.error && (
        <div className="flex flex-col gap-2">
          <MentionInput
            value={draft.body}
            onChange={(body, mentions) => setDraft({ body, mentions })}
            people={mentionable}
            placeholder="Add a comment — type @ to mention someone"
            label="Comment"
            rows={compact ? 2 : 3}
            onSubmit={send}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="hidden text-[11px] text-sand/70 sm:inline">@ to mention · ⌘↵ to send</span>
            <Button
              variant="primary"
              onClick={send}
              disabled={pending || !draft.body.trim()}
              className="ml-auto min-h-9 sm:min-h-0"
            >
              <Icon.send size={13} />
              Comment
            </Button>
          </div>
        </div>
      )}
      {toast}
    </div>
  );
}
