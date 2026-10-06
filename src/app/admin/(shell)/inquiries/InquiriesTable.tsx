"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "@/components/admin/Modal";
import { useAction } from "@/components/admin/useAction";
import { Icon } from "@/components/admin/icons";
import { Avatar, Badge, Button, EmptyState, Field, Panel, Select, Textarea, fieldClass } from "@/components/admin/ui";
import { formatDateTime, relativeTime } from "@/lib/admin/format";
import { hrefFor } from "@/lib/admin/links";
import type { Inquiry, InquiryStatus, Stage } from "@/lib/admin/types";
import { convertInquiries, deleteInquiries, saveInquiryNotes, setInquiryStatus } from "@/app/admin/actions/inquiries";

const STATUS_TONE = {
  new: "terra",
  read: "cream",
  converted: "success",
  archived: "muted",
} as const;

type Tab = { key: InquiryStatus | "all"; label: string; count: number };

export default function InquiriesTable({
  inquiries,
  stages,
  tabs,
  activeTab,
  query,
  focus,
  canCrm,
}: {
  inquiries: Inquiry[];
  stages: Stage[];
  /** Can this person open the CRM? Without it there's no moving or viewing leads. */
  canCrm: boolean;
  tabs: Tab[];
  activeTab: InquiryStatus | "all";
  query: string;
  /** `?open=` — opened on load and whenever a link points here again. */
  focus: Inquiry | null;
}) {
  const router = useRouter();
  const { run: runAction, pending, toast } = useAction();
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState<Inquiry | null>(focus);
  const [notes, setNotes] = useState(focus?.notes ?? "");

  // A deep link that changes while the page is open opens that inquiry.
  const [seenFocus, setSeenFocus] = useState(focus?.id ?? null);
  if (seenFocus !== (focus?.id ?? null)) {
    setSeenFocus(focus?.id ?? null);
    if (focus) {
      setOpen(focus);
      setNotes(focus.notes ?? "");
    }
  }

  // Opening a new one from a link reads it, the same as clicking its row.
  const focusId = focus?.status === "new" ? focus.id : null;
  useEffect(() => {
    if (focusId) void setInquiryStatus([focusId], "read").then(() => router.refresh());
  }, [focusId, router]);

  const close = useCallback(() => {
    setOpen(null);
    // Drop ?open= so a refresh doesn't pop it back open; keep the tab and search.
    if (focus) {
      const params = new URLSearchParams(window.location.search);
      params.delete("open");
      router.replace(`/admin/inquiries${params.size ? `?${params}` : ""}`, { scroll: false });
    }
  }, [focus, router]);
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [search, setSearch] = useState(query);

  const allSelected = inquiries.length > 0 && selected.length === inquiries.length;
  const selectedRows = useMemo(
    () => inquiries.filter((i) => selected.includes(i.id)),
    [inquiries, selected],
  );
  const convertible = selectedRows.filter((i) => !i.converted_lead_id).length;

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, clear = true) =>
    runAction(fn, {
      onDone: (result) => {
        if (result.ok && clear) setSelected([]);
      },
    });

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const goTo = (next: { status?: string; q?: string }) => {
    const params = new URLSearchParams();
    const status = next.status ?? activeTab;
    const q = next.q ?? search;
    if (status && status !== "new") params.set("status", status);
    if (q.trim()) params.set("q", q.trim());
    router.push(`/admin/inquiries${params.size ? `?${params}` : ""}`);
  };

  const openRow = (inquiry: Inquiry) => {
    setOpen(inquiry);
    setNotes(inquiry.notes ?? "");
    if (inquiry.status === "new") void setInquiryStatus([inquiry.id], "read").then(() => router.refresh());
  };

  return (
    <>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {tabs.map((t) => {
            const active = t.key === activeTab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => goTo({ status: String(t.key) })}
                className={`inline-flex items-center gap-1.5 border px-3 py-1.5 text-[12px] font-medium transition-all duration-300 ${active
                    ? "border-terra/50 bg-terra/15 text-terra-bright"
                    : "border-cream/12 bg-cream/[0.03] text-cream-2 hover:border-cream/30 hover:text-cream"
                  }`}
              >
                {t.label}
                <span className="font-mono text-[10px] text-sand tabular-nums">{t.count}</span>
              </button>
            );
          })}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            goTo({ q: search });
          }}
          className="relative w-full sm:w-64"
        >
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sand">
            <Icon.search size={14} />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, business, message…"
            className={`${fieldClass} pl-9`}
          />
        </form>
      </div>

      {/* Bulk bar */}
      {selected.length > 0 && (
        <div className="rise-in mb-3 flex flex-wrap items-center gap-2 border border-terra/30 bg-terra/[0.07] px-3 py-2.5">
          <span className="mr-1 font-mono text-[11px] text-cream tabular-nums">
            {selected.length} selected
          </span>
          {canCrm && stages.length > 1 && (
            <select
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              className="border border-cream/12 bg-ink/60 px-2 py-1.5 text-[12px] text-cream-2 focus:border-terra/60 focus:outline-none"
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id} className="bg-ink text-cream">
                  → {s.name}
                </option>
              ))}
            </select>
          )}
          {canCrm && (
            <Button
              variant="primary"
              disabled={pending || convertible === 0}
              onClick={() => run(() => convertInquiries(selected, stageId))}
            >
              <Icon.pipeline size={13} />
              Move to CRM{convertible !== selected.length ? ` (${convertible})` : ""}
            </Button>
          )}
          <Button disabled={pending} onClick={() => run(() => setInquiryStatus(selected, "read"))}>
            <Icon.check size={13} /> Mark read
          </Button>
          <Button disabled={pending} onClick={() => run(() => setInquiryStatus(selected, "archived"))}>
            Archive
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (confirm(`Delete ${selected.length} inquir${selected.length === 1 ? "y" : "ies"}? This cannot be undone.`))
                run(() => deleteInquiries(selected));
            }}
          >
            <Icon.trash size={13} /> Delete
          </Button>
          <Button variant="quiet" onClick={() => setSelected([])} className="ml-auto">
            Clear
          </Button>
        </div>
      )}

      <Panel bodyClass="p-0">
        {inquiries.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="Nothing here yet"
              hint={
                query
                  ? "No inquiry matches that search."
                  : "New submissions from the walkthrough form land here the moment they arrive."
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto scroll-thin" data-lenis-prevent>
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead>
                <tr className="border-b border-cream/[0.08] text-[10px] uppercase tracking-[0.16em] text-sand">
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? [] : inquiries.map((i) => i.id))}
                      className="h-3.5 w-3.5 accent-[#c65d3b]"
                    />
                  </th>
                  <th className="px-3 py-2.5 font-normal">Who</th>
                  <th className="px-3 py-2.5 font-normal">Contact</th>
                  <th className="px-3 py-2.5 font-normal">Focus</th>
                  <th className="px-3 py-2.5 font-normal">Received</th>
                  <th className="px-3 py-2.5 font-normal">Status</th>
                  <th className="w-10 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {inquiries.map((i) => {
                  const isSelected = selected.includes(i.id);
                  return (
                    <tr
                      key={i.id}
                      className={`group border-b border-cream/[0.05] transition-colors last:border-0 ${isSelected ? "bg-terra/[0.06]" : "hover:bg-cream/[0.03]"
                        }`}
                    >
                      <td className="px-3 py-3 align-middle">
                        <input
                          type="checkbox"
                          aria-label={`Select ${i.name}`}
                          checked={isSelected}
                          onChange={() => toggle(i.id)}
                          className="h-3.5 w-3.5 accent-[#c65d3b]"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <button type="button" onClick={() => openRow(i)} className="flex items-center gap-2.5 text-left">
                          <Avatar name={i.name} size={30} />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium text-cream">{i.name}</span>
                            <span className="block truncate text-[11px] text-sand">{i.business ?? "—"}</span>
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-3 text-[12px] text-cream-2">
                        <span className="block truncate">{i.contact}</span>
                        <span className="block text-[10.5px] text-sand">{i.source}</span>
                      </td>
                      <td className="max-w-[220px] px-3 py-3 text-[12px] text-cream-2">
                        <span className="block truncate">{i.focus ?? "—"}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-[11.5px] text-sand" title={formatDateTime(i.created_at)}>
                        {relativeTime(i.created_at)}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={STATUS_TONE[i.status]}>{i.status === "converted" ? "In CRM" : i.status}</Badge>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openRow(i)}
                          aria-label={`Open ${i.name}`}
                          className="text-sand transition-colors hover:text-cream"
                        >
                          <Icon.arrow size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Detail */}
      <Modal
        open={!!open}
        onClose={close}
        title={open?.name ?? ""}
        hint={open ? `${open.business ?? "No business given"} · ${formatDateTime(open.created_at)}` : undefined}
        width="max-w-xl"
        footer={
          open && (
            <>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() => {
                  if (confirm("Delete this inquiry?")) {
                    run(() => deleteInquiries([open.id]));
                    close();
                  }
                }}
              >
                <Icon.trash size={13} /> Delete
              </Button>
              <Button disabled={pending} onClick={() => run(() => setInquiryStatus([open.id], "archived"), false)}>
                Archive
              </Button>
              {!canCrm ? (
                open.converted_lead_id && (
                  <span className="inline-flex items-center gap-1.5 px-1 text-[12px] text-sand">
                    <Icon.pipeline size={13} /> In the CRM
                  </span>
                )
              ) : open.converted_lead_id ? (
                <Link href={hrefFor("lead", open.converted_lead_id) ?? "/admin/crm"} className="btn btn--primary btn--sm rounded-none gap-1.5">
                  <Icon.pipeline size={13} /> View in CRM
                </Link>
              ) : (
                <Button variant="primary" disabled={pending} onClick={() => run(() => convertInquiries([open.id], stageId), false)}>
                  <Icon.pipeline size={13} /> Move to CRM
                </Button>
              )}
            </>
          )
        }
      >
        {open && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                ["Contact", open.contact],
                ["Focus", open.focus ?? "—"],
                ["Source", open.source],
                ["Page", open.page ?? "—"],
              ].map(([k, v]) => (
                <div key={k} className="glass-inset px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-sand">{k}</p>
                  <p className="mt-0.5 break-words text-[12.5px] text-cream">{v}</p>
                </div>
              ))}
            </div>

            {open.message && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-sand">Message</p>
                <p className="mt-1.5 whitespace-pre-wrap border border-cream/[0.08] bg-ink/50 px-3.5 py-3 text-[12.5px] leading-relaxed text-cream-2">
                  {open.message}
                </p>
              </div>
            )}

            <Field label="Internal note">
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context for the team…" />
            </Field>
            <Button disabled={pending} onClick={() => run(() => saveInquiryNotes(open.id, notes), false)}>
              <Icon.check size={13} /> Save note
            </Button>

            {canCrm && stages.length > 1 && !open.converted_lead_id && (
              <Field label="Move into stage">
                <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id} className="bg-ink text-cream">
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}
      </Modal>

      {toast}
    </>
  );
}
