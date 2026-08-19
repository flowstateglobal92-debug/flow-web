"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import Modal from "@/components/admin/Modal";
import { Icon } from "@/components/admin/icons";
import { useAction } from "@/components/admin/useAction";
import { Avatar, Badge, Button, Field, Input, Select, Textarea, fieldClass, labelClass } from "@/components/admin/ui";
import { money, moneyShort, relativeTime } from "@/lib/admin/format";
import type { Lead, LeadActivity, Score, Stage, StageTone } from "@/lib/admin/types";
import {
  addLeadNote,
  createLead,
  createStage,
  deleteLead,
  deleteStage,
  moveLead,
  moveStage,
  updateLead,
  updateStage,
} from "@/app/admin/actions/crm";

const TONE: Record<StageTone, { dot: string; text: string }> = {
  terra: { dot: "bg-terra", text: "text-terra-bright" },
  cream: { dot: "bg-cream/60", text: "text-cream-2" },
  success: { dot: "bg-emerald-300", text: "text-emerald-200" },
  warn: { dot: "bg-amber-300", text: "text-amber-200" },
  muted: { dot: "bg-sand/60", text: "text-sand" },
};

const SCORES: Score[] = ["HOT", "WARM", "COLD"];
const scoreTone = (s: Score): "terra" | "cream" | "muted" =>
  s === "HOT" ? "terra" : s === "WARM" ? "cream" : "muted";

/* ─────────────────────────────── card ──────────────────────────────────── */

function LeadCard({
  lead,
  index,
  onOpen,
  overlay,
}: {
  lead: Lead;
  index?: number;
  onOpen?: () => void;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({
    id: lead.id,
    disabled: overlay,
    data: { stageId: lead.stage_id },
  });
  const { setNodeRef: dropRef } = useDroppable({
    id: `card:${lead.id}`,
    disabled: overlay,
    data: { type: "card", stageId: lead.stage_id, leadId: lead.id, index },
  });

  return (
    <div
      ref={(node) => {
        dragRef(node);
        dropRef(node);
      }}
      {...listeners}
      {...attributes}
      onClick={onOpen}
      className={`group relative select-none border p-3 text-left transition-[box-shadow,border-color,background-color] ${overlay
          ? "pointer-events-none rotate-[2deg] scale-[1.02] cursor-grabbing border-terra/60 bg-ink-2 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.9)] ring-1 ring-terra/50"
          : isDragging
            ? "cursor-grabbing border-dashed border-cream/20 bg-transparent opacity-30"
            : "cursor-grab border-cream/10 bg-cream/[0.035] hover:border-cream/25 hover:bg-cream/[0.06]"
        }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Avatar name={lead.company || lead.name} size={28} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium leading-snug text-cream">
              {lead.company || lead.name}
            </p>
            <p className="truncate text-[11px] text-sand">{lead.company ? lead.name : lead.source}</p>
          </div>
        </div>
        <Badge tone={scoreTone(lead.score)}>{lead.score}</Badge>
      </div>

      {lead.next_action && (
        <p className="mt-2 truncate text-[11px] text-terra-bright/90" title={lead.next_action}>
          → {lead.next_action}
        </p>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-cream/[0.06] pt-2">
        <span className="shrink-0 font-mono text-[11.5px] font-medium text-cream-2 tabular-nums">
          {money(Number(lead.value))}
        </span>
        <span className="truncate text-right text-[10.5px] text-sand">{relativeTime(lead.updated_at)}</span>
      </div>

      <span className="pointer-events-none absolute right-2 top-2 text-cream/0 transition-colors group-hover:text-cream/25">
        <Icon.drag size={13} />
      </span>
    </div>
  );
}

/* ────────────────────────────── column ─────────────────────────────────── */

function Column({
  stage,
  leads,
  onOpenLead,
  onEditStage,
  activeDrag,
}: {
  stage: Stage;
  leads: Lead[];
  onOpenLead: (lead: Lead) => void;
  onEditStage: (stage: Stage) => void;
  activeDrag: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage.id}`, data: { type: "stage", stageId: stage.id } });
  const total = leads.reduce((a, l) => a + Number(l.value), 0);
  const tone = TONE[stage.tone] ?? TONE.cream;

  return (
    <div
      ref={setNodeRef}
      className={`flex w-[248px] shrink-0 flex-col border p-2.5 transition-colors ${isOver ? "border-terra/50 bg-terra/[0.07]" : activeDrag ? "border-cream/[0.12] bg-ink/40" : "border-cream/[0.07] bg-ink/25"
        }`}
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-2.5 pt-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
          <span className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-cream-2">{stage.name}</span>
          {stage.is_protected && (
            <span className="shrink-0 text-sand/70" title="Locked — inquiries land here">
              <Icon.lock size={11} />
            </span>
          )}
          <span className="shrink-0 bg-cream/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-sand tabular-nums">
            {leads.length}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="font-mono text-[10.5px] text-sand tabular-nums">{moneyShort(total)}</span>
          <button
            type="button"
            onClick={() => onEditStage(stage)}
            aria-label={`Stage settings for ${stage.name}`}
            className="text-sand/70 transition-colors hover:text-cream"
          >
            <Icon.edit size={12} />
          </button>
        </div>
      </div>

      <div className="flex min-h-[120px] flex-1 flex-col gap-2">
        {leads.map((lead, i) => (
          <LeadCard key={lead.id} lead={lead} index={i} onOpen={() => onOpenLead(lead)} />
        ))}
        {leads.length === 0 && (
          <div className="flex flex-1 items-center justify-center border border-dashed border-cream/[0.08] px-3 py-6 text-center text-[11px] text-sand/70">
            {activeDrag ? "Drop here" : "Empty"}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────── board ─────────────────────────────────── */

export default function Board({
  stages: stagesProp,
  leads: leadsProp,
  activities,
}: {
  stages: Stage[];
  leads: Lead[];
  activities: LeadActivity[];
}) {
  const { run, pending, toast } = useAction();

  // Local mirror so a drop lands instantly; re-seeded whenever the server sends
  // a new list (the standard "adjust state on prop change" pattern).
  const [leads, setLeads] = useState(leadsProp);
  const [seed, setSeed] = useState(leadsProp);
  if (seed !== leadsProp) {
    setSeed(leadsProp);
    setLeads(leadsProp);
  }

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // The drag overlay portals into document.body — client only.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration gate, runs once
    setMounted(true);
  }, []);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Score | "ALL">("ALL");
  const [search, setSearch] = useState("");

  const [leadModal, setLeadModal] = useState<{ mode: "create" | "edit"; lead?: Lead } | null>(null);
  const [stageModal, setStageModal] = useState<{ mode: "create" | "edit"; stage?: Stage } | null>(null);
  const [note, setNote] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (filter !== "ALL" && l.score !== filter) return false;
      if (!term) return true;
      return [l.name, l.company, l.email, l.phone, l.notes, l.next_action]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [leads, filter, search]);

  const byStage = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const stage of stagesProp) map.set(stage.id, []);
    for (const lead of visible) map.get(lead.stage_id)?.push(lead);
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [visible, stagesProp]);

  const activeLead = leads.find((l) => l.id === activeId) ?? null;
  const openLead = leadModal?.mode === "edit" ? leads.find((l) => l.id === leadModal.lead?.id) ?? null : null;
  const leadTrail = openLead ? activities.filter((a) => a.lead_id === openLead.id).slice(0, 12) : [];

  const totals = useMemo(() => {
    const open = stagesProp.filter((s) => !s.is_won && !s.is_lost).map((s) => s.id);
    const openValue = leads.filter((l) => open.includes(l.stage_id)).reduce((a, l) => a + Number(l.value), 0);
    const wonIds = stagesProp.filter((s) => s.is_won).map((s) => s.id);
    const wonValue = leads.filter((l) => wonIds.includes(l.stage_id)).reduce((a, l) => a + Number(l.value), 0);
    return { openValue, wonValue };
  }, [leads, stagesProp]);

  /* ── drag ── */
  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const id = String(event.active.id);
    const data = event.over?.data.current as
      | { type: "stage" | "card"; stageId: string; leadId?: string }
      | undefined;
    if (!data) return;

    const lead = leads.find((l) => l.id === id);
    if (!lead) return;

    const targetStage = data.stageId;
    // Index against the real column, not the filtered view — otherwise a drop
    // made while searching would land at the wrong depth.
    const column = leads
      .filter((l) => l.stage_id === targetStage && l.id !== id)
      .sort((a, b) => a.position - b.position);
    const index =
      data.type === "card" && data.leadId
        ? Math.max(0, column.findIndex((l) => l.id === data.leadId))
        : column.length;

    if (lead.stage_id === targetStage && lead.position === column[index]?.position) return;

    // Optimistic: reposition locally, then let the server renumber.
    const reordered = [...column];
    reordered.splice(index, 0, { ...lead, stage_id: targetStage });
    const positions = new Map(reordered.map((l, i) => [l.id, i]));
    setLeads((prev) =>
      prev.map((l) =>
        l.id === id
          ? { ...l, stage_id: targetStage, position: positions.get(l.id) ?? l.position }
          : positions.has(l.id)
            ? { ...l, position: positions.get(l.id) as number }
            : l,
      ),
    );

    run(() => moveLead(id, targetStage, index), { quiet: true });
  };

  const submitLead = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const editing = leadModal?.mode === "edit" ? leadModal.lead?.id : null;
    run(editing ? () => updateLead(editing, fd) : () => createLead(fd), {
      onDone: (result) => {
        if (result.ok) setLeadModal(null);
      },
    });
  };

  const submitStage = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const editing = stageModal?.mode === "edit" ? stageModal.stage?.id : null;
    run(editing ? () => updateStage(editing, fd) : () => createStage(fd), {
      onDone: (result) => {
        if (result.ok) setStageModal(null);
      },
    });
  };

  return (
    <>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => setLeadModal({ mode: "create" })}>
            <Icon.plus size={13} /> Add lead
          </Button>
          <Button onClick={() => setStageModal({ mode: "create" })}>
            <Icon.plus size={13} /> New stage
          </Button>
          <div className="ml-1 flex items-center gap-1">
            {(["ALL", ...SCORES] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`border px-2.5 py-1.5 text-[11.5px] font-medium transition-all duration-300 ${filter === f
                    ? "border-terra/50 bg-terra/15 text-terra-bright"
                    : "border-cream/12 bg-cream/[0.03] text-cream-2 hover:border-cream/30 hover:text-cream"
                  }`}
              >
                {f === "ALL" ? "All" : f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[11px] text-sand tabular-nums">
            {leads.length} leads · <span className="text-cream-2">{moneyShort(totals.openValue)}</span> open ·{" "}
            <span className="text-emerald-200">{moneyShort(totals.wonValue)}</span> won
          </span>
          <div className="relative w-full sm:w-56">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sand">
              <Icon.search size={14} />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads…"
              className={`${fieldClass} pl-9`}
            />
          </div>
        </div>
      </div>

      {/* Board */}
      <DndContext
        id="crm-board"
        sensors={sensors}
        autoScroll={{ threshold: { x: 0.15, y: 0 } }}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="scroll-thin -mx-1 flex items-stretch gap-2.5 overflow-x-auto px-1 pb-3" data-lenis-prevent>
          {stagesProp.map((stage) => (
            <Column
              key={stage.id}
              stage={stage}
              leads={byStage.get(stage.id) ?? []}
              onOpenLead={(lead) => {
                setLeadModal({ mode: "edit", lead });
                setNote("");
              }}
              onEditStage={(s) => setStageModal({ mode: "edit", stage: s })}
              activeDrag={!!activeId}
            />
          ))}

          <button
            type="button"
            onClick={() => setStageModal({ mode: "create" })}
            className="flex w-[150px] shrink-0 flex-col items-center justify-center gap-2 border border-dashed border-cream/[0.10] text-sand transition-colors hover:border-terra/40 hover:text-terra-bright"
          >
            <Icon.plus size={18} />
            <span className="text-[11.5px]">New stage</span>
          </button>
        </div>

        {mounted &&
          createPortal(
            <DragOverlay zIndex={9999} dropAnimation={{ duration: 200, easing: "cubic-bezier(0.22,1,0.36,1)" }}>
              {activeLead ? <LeadCard lead={activeLead} overlay /> : null}
            </DragOverlay>,
            document.body,
          )}
      </DndContext>

      {/* Lead modal */}
      <Modal
        open={!!leadModal}
        onClose={() => setLeadModal(null)}
        title={leadModal?.mode === "edit" ? openLead?.company || openLead?.name || "Lead" : "Add a lead"}
        hint={
          leadModal?.mode === "edit"
            ? `Added ${openLead ? relativeTime(openLead.created_at) : ""}${openLead?.inquiry_id ? " · from an inquiry" : ""}`
            : "Manual entry — everything except the name is optional."
        }
        width="max-w-2xl"
      >
        <form onSubmit={submitLead} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Contact name">
              <Input name="name" required defaultValue={openLead?.name ?? ""} placeholder="Nadia Perera" />
            </Field>
            <Field label="Business">
              <Input name="company" defaultValue={openLead?.company ?? ""} placeholder="Perera Dental" />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" defaultValue={openLead?.email ?? ""} placeholder="nadia@example.lk" />
            </Field>
            <Field label="Phone / WhatsApp">
              <Input name="phone" defaultValue={openLead?.phone ?? ""} placeholder="+94 7…" />
            </Field>
            <Field label="Deal value (Rs)">
              <Input name="value" type="number" min="0" step="100" defaultValue={openLead?.value ?? 0} />
            </Field>
            <Field label="Score">
              <Select name="score" defaultValue={openLead?.score ?? "WARM"}>
                {SCORES.map((s) => (
                  <option key={s} value={s} className="bg-ink text-cream">
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Source">
              <Input name="source" defaultValue={openLead?.source ?? "manual"} placeholder="referral, WhatsApp…" />
            </Field>
            <Field label="Next action">
              <Input name="next_action" defaultValue={openLead?.next_action ?? ""} placeholder="Send proposal" />
            </Field>
          </div>

          {leadModal?.mode === "create" && (
            <Field label="Stage">
              <Select name="stage_id" defaultValue={stagesProp[0]?.id}>
                {stagesProp.map((s) => (
                  <option key={s.id} value={s.id} className="bg-ink text-cream">
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Notes">
            <Textarea name="notes" rows={3} defaultValue={openLead?.notes ?? ""} placeholder="Context, requirements, budget…" />
          </Field>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
            {leadModal?.mode === "edit" && openLead && (
              <Button
                type="button"
                variant="danger"
                disabled={pending}
                className="mr-auto"
                onClick={() => {
                  if (confirm(`Delete ${openLead.company || openLead.name}? This cannot be undone.`))
                    run(() => deleteLead(openLead.id), { onDone: (r) => r.ok && setLeadModal(null) });
                }}
              >
                <Icon.trash size={13} /> Delete
              </Button>
            )}
            <Button type="button" onClick={() => setLeadModal(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {leadModal?.mode === "edit" ? "Save changes" : "Add lead"}
            </Button>
          </div>
        </form>

        {leadModal?.mode === "edit" && openLead && (
          <div className="mt-5 border-t border-cream/[0.08] pt-4">
            <p className={labelClass}>Activity</p>
            <div className="flex gap-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note…"
                className={fieldClass}
              />
              <Button
                type="button"
                disabled={pending || !note.trim()}
                onClick={() => run(() => addLeadNote(openLead.id, note), { onDone: (r) => r.ok && setNote("") })}
              >
                Add
              </Button>
            </div>
            <ul className="mt-3 space-y-2">
              {leadTrail.length === 0 && <li className="text-[11.5px] text-sand">No activity recorded yet.</li>}
              {leadTrail.map((a) => (
                <li key={a.id} className="flex items-start gap-2.5 border-b border-cream/[0.05] pb-2 last:border-0">
                  <span className="mt-0.5 shrink-0 text-sand/70">
                    {a.kind === "stage" ? <Icon.pipeline size={13} /> : <Icon.note size={13} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] text-cream-2">{a.body}</span>
                    <span className="block text-[10.5px] text-sand">{relativeTime(a.created_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>

      {/* Stage modal */}
      <Modal
        open={!!stageModal}
        onClose={() => setStageModal(null)}
        title={stageModal?.mode === "edit" ? "Edit stage" : "New stage"}
        hint={
          stageModal?.stage?.is_protected
            ? "New leads is locked — it always stays first and keeps its name."
            : "Stages are columns on the board. Mark one as won or lost to keep the totals honest."
        }
      >
        <form onSubmit={submitStage} className="space-y-4">
          <Field label="Name">
            <Input
              name="name"
              required
              defaultValue={stageModal?.stage?.name ?? ""}
              disabled={stageModal?.stage?.is_protected}
              placeholder="Proposal sent"
            />
          </Field>
          <Field label="Accent">
            <Select name="tone" defaultValue={stageModal?.stage?.tone ?? "cream"}>
              {(["terra", "cream", "success", "warn", "muted"] as StageTone[]).map((t) => (
                <option key={t} value={t} className="bg-ink text-cream">
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-[12.5px] text-cream-2">
              <input
                type="checkbox"
                name="is_won"
                defaultChecked={stageModal?.stage?.is_won}
                className="h-3.5 w-3.5 accent-[#c65d3b]"
              />
              Counts as won
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-cream-2">
              <input
                type="checkbox"
                name="is_lost"
                defaultChecked={stageModal?.stage?.is_lost}
                className="h-3.5 w-3.5 accent-[#c65d3b]"
              />
              Counts as lost
            </label>
          </div>

          {stageModal?.mode === "edit" && stageModal.stage && !stageModal.stage.is_protected && (
            <div className="flex items-center gap-2 border-t border-cream/[0.08] pt-3">
              <span className={labelClass + " mb-0"}>Order</span>
              <Button
                type="button"
                disabled={pending}
                onClick={() => run(() => moveStage(stageModal.stage!.id, "left"))}
              >
                <Icon.chevronLeft size={13} /> Left
              </Button>
              <Button
                type="button"
                disabled={pending}
                onClick={() => run(() => moveStage(stageModal.stage!.id, "right"))}
              >
                Right <Icon.chevronRight size={13} />
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
            {stageModal?.mode === "edit" && stageModal.stage && !stageModal.stage.is_protected && (
              <Button
                type="button"
                variant="danger"
                disabled={pending}
                className="mr-auto"
                onClick={() => {
                  const target = stageModal.stage!;
                  const count = leads.filter((l) => l.stage_id === target.id).length;
                  const msg = count
                    ? `Delete "${target.name}"? Its ${count} lead${count === 1 ? "" : "s"} will move to the first stage.`
                    : `Delete "${target.name}"?`;
                  if (confirm(msg)) run(() => deleteStage(target.id), { onDone: (r) => r.ok && setStageModal(null) });
                }}
              >
                <Icon.trash size={13} /> Delete stage
              </Button>
            )}
            <Button type="button" onClick={() => setStageModal(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {stageModal?.mode === "edit" ? "Save stage" : "Create stage"}
            </Button>
          </div>
        </form>
      </Modal>

      {toast}
    </>
  );
}
