"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Modal from "@/components/admin/Modal";
import { useAction } from "@/components/admin/useAction";
import { Icon } from "@/components/admin/icons";
import { Avatar, Badge, Button, EmptyState, Field, Input, Panel, fieldClass } from "@/components/admin/ui";
import { formatDateTime, relativeTime } from "@/lib/admin/format";
import { forwardSubject, replySubject } from "@/lib/email/address";
import {
  FOLDERS,
  formatBytes,
  type MailDetail,
  type MailFlags,
  type MailFolder,
  type MailPage,
  type MailRef,
  type MailSummary,
} from "@/lib/email/types";
import { forwardMail, markMailRead, setMailFlags } from "@/app/admin/actions/email";
import Compose, { emptyDraft, type Draft } from "./Compose";
import MessageBody from "./MessageBody";

/** Delivery state Resend reports for sent mail. */
const STATUS_TONE: Record<string, "success" | "danger" | "warn" | "muted"> = {
  delivered: "success",
  sent: "muted",
  queued: "muted",
  scheduled: "muted",
  opened: "success",
  clicked: "success",
  bounced: "danger",
  failed: "danger",
  complained: "danger",
  canceled: "muted",
  suppressed: "warn",
  delivery_delayed: "warn",
};

/** Cheap tag strip so a quoted reply reads sensibly when there's no text part. */
const toPlain = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const quote = (mail: MailDetail) => {
  const body = mail.text?.trim() || (mail.html ? toPlain(mail.html) : "");
  const head = `On ${formatDateTime(mail.date)}, ${mail.from.name} <${mail.from.address}> wrote:`;
  return `\n\n${head}\n${body.split("\n").map((line) => `> ${line}`).join("\n")}`;
};

export default function Mailbox({
  page,
  folder,
  query,
  cursor,
  open,
  openError,
  from,
  mailbox,
}: {
  page: MailPage;
  folder: MailFolder;
  query: string;
  /** Cursor this page was loaded at — carried along so opening a message
      doesn't silently snap the list back to the newest page. */
  cursor: string;
  open: MailDetail | null;
  openError: string | null;
  from: string;
  mailbox: string;
}) {
  const router = useRouter();
  const { run: runAction, pending, toast } = useAction();

  const [search, setSearch] = useState(query);
  const [selected, setSelected] = useState<string[]>([]);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [forwarding, setForwarding] = useState<MailDetail | null>(null);
  const [forwardTo, setForwardTo] = useState("");
  /** Remote images are unblocked per message, never carried to the next one. */
  const [imagesFor, setImagesFor] = useState<string | null>(null);
  const showImages = imagesFor !== null && imagesFor === open?.id;

  const items = page.items;
  const unread = items.filter((m) => !m.flags.read).length;

  /* ─────────────────────────── navigation ─────────────────────────── */

  const go = (next: {
    folder?: MailFolder;
    q?: string;
    id?: string | null;
    dir?: string;
    /** A string moves the window, `null` returns to the newest page. */
    after?: string | null;
  }) => {
    const params = new URLSearchParams();
    const target = next.folder ?? folder;
    const q = next.q ?? search;
    const after = next.after === undefined ? cursor : next.after;
    if (target !== "inbox") params.set("folder", target);
    if (q.trim()) params.set("q", q.trim());
    if (after) params.set("after", after);
    if (next.id) {
      params.set("id", next.id);
      if (next.dir) params.set("dir", next.dir);
    }
    router.push(`/admin/email${params.size ? `?${params}` : ""}`);
  };

  /* ───────────────────────────── actions ──────────────────────────── */

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, clear = true) =>
    runAction(fn, { onDone: (result) => { if (result.ok && clear) setSelected([]); } });

  const refs = (ids: string[]): MailRef[] =>
    ids.map((id) => ({ id, direction: items.find((m) => m.id === id)?.direction ?? "inbound" }));

  const flag = (ids: string[], patch: Partial<MailFlags>, clear = true) =>
    run(() => setMailFlags(refs(ids), patch), clear);

  // Opening a message is what marks it read — same as the inquiries table.
  //
  // Keyed on the id rather than the message object: the refresh that follows
  // hands back a fresh object every time, and the flag it carries only flips
  // once the write has landed. Without the ledger of ids already marked, a slow
  // or failed write would have this firing on every render.
  const marked = useRef(new Set<string>());
  const openId = open?.id;
  const openDirection = open?.direction;
  const openRead = open?.flags.read;

  useEffect(() => {
    if (!openId || !openDirection || openRead || marked.current.has(openId)) return;
    marked.current.add(openId);
    void markMailRead({ id: openId, direction: openDirection }).then(() => router.refresh());
  }, [openId, openDirection, openRead, router]);

  const compose = (next: Draft) => {
    setDraft(next);
    setComposing(true);
  };

  const reply = (mail: MailDetail, all: boolean) => {
    const to = mail.direction === "inbound" ? mail.replyTo[0] || mail.from.address : mail.to.join(", ");
    const others = all
      ? [...mail.to, ...mail.cc].filter((a) => !a.toLowerCase().includes(mailbox.toLowerCase()) && a !== to)
      : [];
    compose({
      to,
      cc: others.join(", "),
      bcc: "",
      subject: replySubject(mail.subject),
      body: quote(mail),
      inReplyTo: mail.messageId ?? undefined,
    });
  };

  /* ───────────────────────────── render ───────────────────────────── */

  const toolbar = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {FOLDERS.map((f) => {
          const active = f.key === folder;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => { setSelected([]); go({ folder: f.key, id: null, after: null }); }}
              className={`inline-flex items-center gap-1.5 border px-3 py-1.5 text-[12px] font-medium transition-all duration-300 ${
                active
                  ? "border-terra/50 bg-terra/15 text-terra-bright"
                  : "border-cream/12 bg-cream/[0.03] text-cream-2 hover:border-cream/30 hover:text-cream"
              }`}
            >
              {f.label}
              {f.key === "inbox" && unread > 0 && (
                <span className="font-mono text-[10px] text-sand tabular-nums">{unread}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex w-full items-center gap-2 sm:w-auto">
        <form
          onSubmit={(e) => { e.preventDefault(); go({ q: search, id: null, after: null }); }}
          className="relative min-w-0 flex-1 sm:w-56 sm:flex-none"
        >
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sand">
            <Icon.search size={14} />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sender, subject…"
            className={`${fieldClass} pl-9`}
          />
        </form>
        <Button onClick={() => router.refresh()} disabled={pending} aria-label="Refresh">
          <Icon.refresh size={13} />
        </Button>
        <Button variant="primary" data-shortcut="new" onClick={() => compose(emptyDraft)}>
          <Icon.edit size={13} /> Compose
        </Button>
      </div>
    </div>
  );

  const list = (
    <Panel
      bodyClass="p-0"
      className={open ? "hidden lg:block" : ""}
      title={FOLDERS.find((f) => f.key === folder)?.label}
      hint={`${items.length} message${items.length === 1 ? "" : "s"}${query ? " matching" : ""}`}
      right={
        items.length > 0 ? (
          <label className="flex items-center gap-1.5 text-[11px] text-sand">
            <input
              type="checkbox"
              aria-label="Select all"
              checked={selected.length === items.length}
              onChange={() => setSelected(selected.length === items.length ? [] : items.map((m) => m.id))}
              className="h-3.5 w-3.5 accent-terra"
            />
            All
          </label>
        ) : undefined
      }
    >
      {selected.length > 0 && (
        <div className="rise-in flex flex-wrap items-center gap-1.5 border-b border-terra/25 bg-terra/[0.07] px-3 py-2">
          <span className="mr-1 font-mono text-[11px] text-cream tabular-nums">{selected.length}</span>
          <Button disabled={pending} onClick={() => flag(selected, { read: true })}>
            <Icon.check size={12} /> Read
          </Button>
          <Button disabled={pending} onClick={() => flag(selected, { starred: true })}>
            <Icon.star size={12} /> Star
          </Button>
          {folder === "trash" ? (
            <Button disabled={pending} onClick={() => flag(selected, { trashed: false })}>
              Restore
            </Button>
          ) : (
            <>
              <Button disabled={pending} onClick={() => flag(selected, { archived: true })}>
                <Icon.archive size={12} /> Archive
              </Button>
              <Button variant="danger" disabled={pending} onClick={() => flag(selected, { trashed: true })}>
                <Icon.trash size={12} /> Trash
              </Button>
            </>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title={query ? "No match" : "Nothing here"}
            hint={
              query
                ? "Search covers the messages loaded in this folder — try Load older, or a shorter term."
                : folder === "inbox"
                  ? `Mail sent to ${mailbox} lands here as soon as it arrives.`
                  : "This folder is empty."
            }
          />
        </div>
      ) : (
        <ul className="max-h-[calc(100vh-320px)] min-h-[240px] overflow-y-auto scroll-thin" data-lenis-prevent>
          {items.map((mail) => (
            <Row
              key={mail.id}
              mail={mail}
              active={open?.id === mail.id}
              checked={selected.includes(mail.id)}
              onCheck={() =>
                setSelected((prev) =>
                  prev.includes(mail.id) ? prev.filter((x) => x !== mail.id) : [...prev, mail.id],
                )
              }
              onOpen={() => go({ id: mail.id, dir: mail.direction })}
            />
          ))}
        </ul>
      )}

      {(page.nextCursor || cursor) && (
        <div className="flex gap-2 border-t border-cream/[0.07] p-3">
          {cursor && (
            <Button className="flex-1" disabled={pending} onClick={() => go({ after: null, id: null })}>
              Newest
            </Button>
          )}
          {page.nextCursor && (
            <Button className="flex-1" disabled={pending} onClick={() => go({ after: page.nextCursor, id: null })}>
              Older
            </Button>
          )}
        </div>
      )}
    </Panel>
  );

  const reader = (
    <div className={open ? "" : "hidden lg:block"}>
      {openError ? (
        <Panel title="That message didn't load">
          <p className="text-[12.5px] text-bad-200">{openError}</p>
        </Panel>
      ) : !open ? (
        <Panel bodyClass="p-4">
          <EmptyState title="Nothing selected" hint="Pick a message on the left to read it here." />
        </Panel>
      ) : (
        <Panel bodyClass="p-0">
          <header className="border-b border-cream/[0.07] px-4 py-3.5">
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <Button className="lg:hidden" onClick={() => go({ id: null })}>
                <Icon.chevron size={13} className="rotate-90" /> Back
              </Button>
              {open.direction === "inbound" && (
                <>
                  <Button variant="primary" onClick={() => reply(open, false)}>
                    <Icon.reply size={13} /> Reply
                  </Button>
                  {[...open.to, ...open.cc].length > 1 && (
                    <Button onClick={() => reply(open, true)}>Reply all</Button>
                  )}
                  <Button onClick={() => { setForwardTo(""); setForwarding(open); }}>
                    <Icon.forward size={13} /> Forward
                  </Button>
                </>
              )}
              {open.direction === "outbound" && (
                <Button
                  variant="primary"
                  onClick={() =>
                    compose({
                      to: open.to.join(", "),
                      cc: open.cc.join(", "),
                      bcc: "",
                      subject: open.subject,
                      body: open.text?.trim() || (open.html ? toPlain(open.html) : ""),
                    })
                  }
                >
                  <Icon.send size={13} /> Send again
                </Button>
              )}
              <span className="ml-auto flex items-center gap-1.5">
                <Button
                  aria-label={open.flags.starred ? "Unstar" : "Star"}
                  disabled={pending}
                  onClick={() => flag([open.id], { starred: !open.flags.starred }, false)}
                  className={open.flags.starred ? "text-terra-bright" : ""}
                >
                  <Icon.star size={13} />
                </Button>
                <Button
                  disabled={pending}
                  onClick={() => flag([open.id], { read: false }, false)}
                  title="Mark unread"
                >
                  <Icon.mail size={13} />
                </Button>
                <Button
                  disabled={pending}
                  onClick={() => flag([open.id], { archived: !open.flags.archived }, false)}
                >
                  <Icon.archive size={13} />
                </Button>
                <Button
                  variant="danger"
                  disabled={pending}
                  onClick={() => {
                    flag([open.id], { trashed: !open.flags.trashed }, false);
                    if (!open.flags.trashed) go({ id: null });
                  }}
                >
                  <Icon.trash size={13} />
                </Button>
              </span>
            </div>

            <h2 className="font-display text-[17px] font-medium leading-snug text-cream">{open.subject}</h2>

            <div className="mt-3 flex items-start gap-2.5">
              <Avatar name={open.from.name} size={34} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-cream">
                  {open.from.name} <span className="text-sand">&lt;{open.from.address}&gt;</span>
                </p>
                <p className="truncate text-[11.5px] text-sand">To {open.to.join(", ") || "—"}</p>
                {open.cc.length > 0 && <p className="truncate text-[11.5px] text-sand">Cc {open.cc.join(", ")}</p>}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[11px] text-sand">{formatDateTime(open.date)}</p>
                {open.status && (
                  <Badge tone={STATUS_TONE[open.status] ?? "muted"} className="mt-1">
                    {open.status.replace(/_/g, " ")}
                  </Badge>
                )}
              </div>
            </div>
          </header>

          {open.attachmentList.filter((a) => !a.inline).length > 0 && (
            <div className="flex flex-wrap gap-2 border-b border-cream/[0.07] px-4 py-3">
              {open.attachmentList
                .filter((a) => !a.inline)
                .map((file) => (
                  <a
                    key={file.id}
                    href={`/admin/email/attachment/${open.direction}/${open.id}/${file.id}`}
                    className="group inline-flex max-w-full items-center gap-2 border border-cream/12 bg-cream/[0.03] px-3 py-1.5 text-[12px] text-cream-2 transition-all duration-300 hover:border-terra/40 hover:text-cream"
                  >
                    <Icon.paperclip size={13} />
                    <span className="min-w-0 truncate">{file.filename}</span>
                    <span className="shrink-0 font-mono text-[10.5px] text-sand tabular-nums">
                      {formatBytes(file.size)}
                    </span>
                  </a>
                ))}
            </div>
          )}

          <div className="p-4">
            {open.html && !showImages && (
              <button
                type="button"
                onClick={() => setImagesFor(open.id)}
                className="mb-3 inline-flex items-center gap-1.5 border border-cream/12 bg-cream/[0.03] px-3 py-1.5 text-[11.5px] text-cream-2 transition-colors hover:border-cream/30 hover:text-cream"
              >
                <Icon.image size={13} /> Show remote images
              </button>
            )}
            <MessageBody
              key={`${open.id}:${showImages}`}
              html={open.html}
              text={open.text}
              showRemoteImages={showImages}
            />
          </div>
        </Panel>
      )}
    </div>
  );

  return (
    <>
      {toolbar}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,370px)_minmax(0,1fr)]">
        {list}
        {reader}
      </div>

      <Compose
        open={composing}
        draft={draft}
        from={from}
        pending={pending}
        onClose={() => setComposing(false)}
        onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
        onSend={(send) => run(send, false)}
      />

      <Modal
        open={!!forwarding}
        onClose={() => setForwarding(null)}
        title="Forward message"
        hint="The original is passed through untouched, attachments included."
        footer={
          <>
            <Button onClick={() => setForwarding(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={pending || !forwardTo.trim()}
              onClick={() => {
                const id = forwarding!.id;
                run(async () => {
                  const result = await forwardMail(id, forwardTo);
                  if (result.ok) setForwarding(null);
                  return result;
                }, false);
              }}
            >
              <Icon.forward size={13} /> Forward
            </Button>
          </>
        }
      >
        <Field label="To" hint="Separate several addresses with commas.">
          <Input value={forwardTo} onChange={(e) => setForwardTo(e.target.value)} placeholder="name@company.com" />
        </Field>
        {forwarding && (
          <p className="mt-3 text-[11.5px] text-sand">
            {forwardSubject(forwarding.subject)} · from {forwarding.from.address}
          </p>
        )}
      </Modal>

      {toast}
    </>
  );
}

/* ────────────────────────────── list row ─────────────────────────────── */

function Row({
  mail,
  active,
  checked,
  onCheck,
  onOpen,
}: {
  mail: MailSummary;
  active: boolean;
  checked: boolean;
  onCheck: () => void;
  onOpen: () => void;
}) {
  const who = mail.direction === "inbound" ? mail.from.name : mail.to[0] || "—";
  const unread = !mail.flags.read;

  return (
    <li
      className={`flex items-start gap-2.5 border-b border-cream/[0.05] px-3 py-2.5 transition-colors last:border-0 ${
        active ? "bg-terra/[0.10]" : checked ? "bg-terra/[0.06]" : "hover:bg-cream/[0.03]"
      }`}
    >
      <input
        type="checkbox"
        aria-label={`Select ${mail.subject}`}
        checked={checked}
        onChange={onCheck}
        className="mt-1.5 h-3.5 w-3.5 shrink-0 accent-terra"
      />
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
        <span className="relative shrink-0">
          <Avatar name={who} size={30} />
          {unread && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-terra" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={`min-w-0 flex-1 truncate text-[12.5px] ${unread ? "font-semibold text-cream" : "text-cream-2"}`}>
              {mail.direction === "outbound" ? `To ${who}` : who}
            </span>
            <span className="shrink-0 text-[10.5px] text-sand" title={formatDateTime(mail.date)}>
              {relativeTime(mail.date)}
            </span>
          </span>
          <span className={`mt-0.5 block truncate text-[12px] ${unread ? "text-cream" : "text-sand"}`}>
            {mail.subject}
          </span>
          <span className="mt-1 flex items-center gap-2 text-sand">
            {mail.flags.starred && <Icon.star size={11} className="text-terra-bright" />}
            {mail.attachments > 0 && (
              <span className="inline-flex items-center gap-1 text-[10.5px]">
                <Icon.paperclip size={11} /> {mail.attachments}
              </span>
            )}
            {mail.status && mail.status !== "delivered" && (
              <span className="font-mono text-[9.5px] uppercase tracking-[0.1em]">
                {mail.status.replace(/_/g, " ")}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}
