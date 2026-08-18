"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { sleep, useOS } from "../OSContext";
import { Avatar, GhostButton, Icon, Pill, PrimaryButton, ScoreBadge, type Score } from "../ui";

/* ───────────── Data ───────────── */
type StageId = "new" | "contacted" | "proposal" | "negotiation" | "won";

type Lead = {
  id: string;
  name: string;
  company: string;
  value: number;
  score: Score;
  stage: StageId;
  last: string;
  source: "WhatsApp" | "Website" | "Lead hunter" | "Referral";
};

const STAGES: { id: StageId; label: string; extra: number; nba: string }[] = [
  { id: "new", label: "New", extra: 15, nba: "Send WhatsApp intro" },
  { id: "contacted", label: "Contacted", extra: 10, nba: "Book discovery call" },
  { id: "proposal", label: "Proposal", extra: 5, nba: "Follow up — proposal opened" },
  { id: "negotiation", label: "Negotiation", extra: 3, nba: "Send revised quote" },
  { id: "won", label: "Won", extra: 1, nba: "Kickoff scheduled" },
];

const INITIAL: Lead[] = [
  { id: "l1", name: "Nadia Perera", company: "Perera Dental", value: 2400, score: "WARM", stage: "new", last: "Inquiry via WhatsApp · 4m", source: "WhatsApp" },
  { id: "l2", name: "Ravi Cedar", company: "Cedar & Co", value: 6800, score: "COLD", stage: "new", last: "Detected slow website · 1h", source: "Lead hunter" },
  { id: "l3", name: "Ishara Silva", company: "Lumen Fitness", value: 3200, score: "HOT", stage: "new", last: "Booked call for Thu · 12m", source: "Website" },
  { id: "l4", name: "Maya Fernando", company: "Aria Studio", value: 9500, score: "HOT", stage: "contacted", last: "Replied to audit · 2h", source: "WhatsApp" },
  { id: "l5", name: "Dilan Jay", company: "Harbour Café", value: 1900, score: "WARM", stage: "contacted", last: "Call completed · 1d", source: "Referral" },
  { id: "l6", name: "Tom Aluwihare", company: "Bluefin Logistics", value: 12000, score: "HOT", stage: "proposal", last: "Proposal opened · 2h", source: "Website" },
  { id: "l7", name: "Anjali Rao", company: "Nova Clinic", value: 4300, score: "WARM", stage: "proposal", last: "Proposal sent · 3d", source: "WhatsApp" },
  { id: "l8", name: "Kasun Solis", company: "Solis Realty", value: 18000, score: "HOT", stage: "negotiation", last: "Revised scope · 5h", source: "Referral" },
  { id: "l9", name: "Priya Kite", company: "Kite Interiors", value: 7200, score: "HOT", stage: "won", last: "Signed · project live", source: "WhatsApp" },
];

const ORCHESTRATION = [
  { t: "Deal moved to Won", d: "Pipeline updates instantly", tag: "+1 won" },
  { t: "Project created", d: "Milestones and context carry forward", tag: "project" },
  { t: "Deposit invoice prepared", d: "No duplicate data entry", tag: "40% deposit" },
  { t: "Payment instructions sent", d: "The client knows the next step", tag: "WhatsApp + email" },
  { t: "Onboarding team alerted", d: "Kickoff checklist assigned", tag: "3 tasks" },
];

const money = (n: number) => "Rs " + n.toLocaleString("en-US");
const stageIndex = (s: StageId) => STAGES.findIndex((x) => x.id === s);

/* ───────────── Card ───────────── */
function LeadCard({
  lead,
  selected,
  onSelect,
  overlay,
}: {
  lead: Lead;
  selected?: boolean;
  onSelect?: () => void;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    disabled: overlay,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onSelect}
      className={`group relative select-none rounded-none border p-3 text-left transition-[box-shadow,border-color,background-color] ${
        overlay
          ? "cursor-grabbing rotate-[2deg] scale-[1.02] border-terra/60 bg-ink-2 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.9),0_0_0_1px_rgba(198,93,59,0.4)] ring-1 ring-terra/50 pointer-events-none"
          : isDragging
            ? "cursor-grabbing border-dashed border-cream/20 bg-transparent opacity-30"
            : selected
              ? "cursor-grab border-terra/50 bg-cream/[0.06] shadow-[0_0_0_1px_rgba(198,93,59,0.25)]"
              : "cursor-grab border-cream/10 bg-cream/[0.035] hover:border-cream/25 hover:bg-cream/[0.06]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Avatar name={lead.name} size={28} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium leading-snug text-cream" title={lead.company}>
              {lead.company}
            </p>
            <p className="truncate text-[11px] text-sand" title={lead.name}>
              {lead.name}
            </p>
          </div>
        </div>
        <ScoreBadge score={lead.score} className="shrink-0" />
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-cream/[0.06] pt-2">
        <span className="shrink-0 font-mono text-[11.5px] font-medium text-cream-2 tabular-nums">
          {money(lead.value)}
        </span>
        <span className="min-w-0 truncate text-right text-[10.5px] text-sand" title={lead.last}>
          {lead.last}
        </span>
      </div>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-cream/0 transition-colors group-hover:text-cream/25">
        <Icon.drag size={14} />
      </span>
    </div>
  );
}

/* ───────────── Column ───────────── */
function Column({
  stage,
  leads,
  selectedId,
  onSelect,
  highlight,
}: {
  stage: (typeof STAGES)[number];
  leads: Lead[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  highlight?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const total = leads.reduce((a, l) => a + l.value, 0);
  const isWon = stage.id === "won";
  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-[210px] sm:min-w-[220px] lg:min-w-[230px] flex-1 flex-col rounded-none border p-2.5 transition-colors ${
        isOver
          ? "border-terra/50 bg-terra/[0.07]"
          : highlight
            ? "border-terra/30 bg-terra/[0.04]"
            : "border-cream/[0.07] bg-ink/25"
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-2.5 pt-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isWon ? "bg-emerald-300" : "bg-terra"}`} />
          <span className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-cream-2">
            {stage.label}
          </span>
          <span className="shrink-0 rounded-none bg-cream/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-sand tabular-nums">
            {leads.length + stage.extra}
          </span>
        </div>
        <span className="shrink-0 font-mono text-[10.5px] text-sand tabular-nums">{money(total)}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {leads.map((l) => (
          <LeadCard key={l.id} lead={l} selected={selectedId === l.id} onSelect={() => onSelect(l.id)} />
        ))}
        {stage.extra > 0 && (
          <div className="rounded-none border border-dashed border-cream/[0.08] px-3 py-2 text-center text-[11px] text-sand/70">
            +{stage.extra} more
          </div>
        )}
        {isWon && (
          <div
            className={`mt-auto rounded-none border border-dashed px-3 py-3 text-center text-[11px] transition-colors ${
              isOver ? "border-terra/60 text-terra-bright" : "border-terra/25 text-terra-bright/70"
            }`}
          >
            Drop a lead here to trigger post-signature orchestration
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────── Module ───────────── */
export default function Pipeline() {
  const { log } = useOS();
  const [mounted, setMounted] = useState(false);
  const [leads, setLeads] = useState<Lead[]>(INITIAL);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Score | "ALL">("ALL");
  const [orch, setOrch] = useState<{ lead: Lead; step: number; done: boolean } | null>(null);
  const runId = useRef(0);

  useEffect(() => {
    // Drag-and-drop only exists on the client; gate it after hydration so the
    // SSR markup and the first client render agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration gate, runs once
    setMounted(true);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const visible = useMemo(
    () => (filter === "ALL" ? leads : leads.filter((l) => l.score === filter)),
    [leads, filter],
  );
  const activeLead = leads.find((l) => l.id === activeId) ?? null;
  // A lead hidden by the current filter can't stay selected.
  const selected = visible.find((l) => l.id === selectedId) ?? null;
  const totalValue = leads.reduce((a, l) => a + l.value, 0);

  const runOrchestration = useCallback(
    async (lead: Lead) => {
      const id = ++runId.current;
      setOrch({ lead, step: 0, done: false });
      for (let i = 0; i < ORCHESTRATION.length; i++) {
        await sleep(i === 0 ? 350 : 750);
        if (runId.current !== id) return;
        setOrch({ lead, step: i + 1, done: i === ORCHESTRATION.length - 1 });
        const s = ORCHESTRATION[i];
        log(
          {
            module: i === 2 || i === 3 ? "finance" : i === 1 || i === 4 ? "automations" : "pipeline",
            text: `${s.t} · ${lead.company}`,
            tag: i === 2 ? money(Math.round(lead.value * 0.4)) : s.tag,
            tone: i === ORCHESTRATION.length - 1 ? "success" : "neutral",
          },
          i === 0 ? 2 : 9,
        );
      }
    },
    [log],
  );

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const over = e.over?.id as StageId | undefined;
    const lead = leads.find((l) => l.id === e.active.id);
    if (!over || !lead || lead.stage === over) return;

    const forward = stageIndex(over) > stageIndex(lead.stage);
    const score: Score =
      over === "negotiation" || over === "won" ? "HOT" : forward && lead.score === "COLD" ? "WARM" : lead.score;
    const updated: Lead = {
      ...lead,
      stage: over,
      score,
      last: over === "won" ? "Signed · just now" : `Moved to ${STAGES[stageIndex(over)].label} · now`,
    };
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? updated : l)));
    setSelectedId(lead.id);

    if (over === "won") {
      void runOrchestration(updated);
    } else {
      log(
        {
          module: "pipeline",
          text: `${lead.company} → ${STAGES[stageIndex(over)].label} · score ${score}`,
          tag: forward ? "next action set" : "re-scored",
        },
        3,
      );
    }
  };

  const reset = () => {
    runId.current++;
    setLeads(INITIAL);
    setOrch(null);
    setSelectedId(null);
  };

  const nextBest = (l: Lead) => STAGES[stageIndex(l.stage)].nba;

  const doNextBest = (l: Lead) => {
    log(
      { module: l.stage === "new" ? "inbox" : "automations", text: `${nextBest(l)} · ${l.company}`, tag: "done by system" },
      8,
    );
    setLeads((prev) =>
      prev.map((x) => (x.id === l.id ? { ...x, last: `${nextBest(l)} · now`, score: x.score === "COLD" ? "WARM" : x.score } : x)),
    );
  };

  return (
    <div className="flex h-full flex-col p-4 sm:p-5">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-medium text-cream sm:text-lg">Live pipeline</h3>
            <Pill tone="terra">
              <Icon.bolt size={11} /> Interactive
            </Pill>
          </div>
          <p className="mt-1 text-[12.5px] text-sand">
            Every lead has a stage, a score and a next action. <span className="text-cream-2">Drag a card into Won.</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 font-mono text-[11px] text-sand tabular-nums">
            {leads.length + STAGES.reduce((a, s) => a + s.extra, 0)} leads · {money(totalValue)} shown
          </span>
          {(["ALL", "HOT", "WARM", "COLD"] as const).map((f) => (
            <GhostButton key={f} active={filter === f} onClick={() => setFilter(f)}>
              {f === "ALL" ? "All" : f}
            </GhostButton>
          ))}
          <GhostButton onClick={reset}>Reset</GhostButton>
        </div>
      </div>

      <div className="relative flex-1">
        <DndContext
          id="pipeline-dnd"
          sensors={sensors}
          autoScroll={false}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <div className="scroll-thin -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-2" data-lenis-prevent>
            {STAGES.map((s) => (
              <Column
                key={s.id}
                stage={s}
                leads={visible.filter((l) => l.stage === s.id)}
                selectedId={selectedId}
                onSelect={setSelectedId}
                highlight={s.id === "won" && !!activeId}
              />
            ))}
          </div>
          {mounted &&
            createPortal(
              <DragOverlay
                zIndex={9999}
                dropAnimation={{ duration: 200, easing: "cubic-bezier(0.22,1,0.36,1)" }}
              >
                {activeLead ? <LeadCard lead={activeLead} overlay /> : null}
              </DragOverlay>,
              document.body,
            )}
        </DndContext>

        {/* Slide-over: orchestration or lead profile */}
        <aside
          className={`absolute inset-y-0 right-0 z-10 flex w-[min(300px,100%)] flex-col gap-3 transition-all duration-500 ease-[var(--ease-flow)] ${
            orch || selected ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-6 opacity-0"
          }`}
        >
          {orch ? (
            <div className="os-drawer relative overflow-hidden p-4">
              <div className="glow-terra pointer-events-none absolute -right-10 -top-10 h-32 w-32 opacity-40" />
              <p className="eyebrow text-[10px]">Post-signature orchestration</p>
              <p className="mt-1.5 font-display text-[15px] text-cream">{orch.lead.company}</p>
              <p className="text-[11.5px] text-sand">One signature. Five controlled actions.</p>
              <ol className="mt-4 space-y-2.5">
                {ORCHESTRATION.map((s, i) => {
                  const state = i < orch.step ? "done" : i === orch.step ? "active" : "todo";
                  return (
                    <li key={s.t} className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ring-1 transition-all duration-500 ${
                          state === "done"
                            ? "bg-terra text-cream ring-terra"
                            : state === "active"
                              ? "bg-terra/20 text-terra-bright ring-terra/60"
                              : "bg-transparent text-sand ring-cream/15"
                        }`}
                      >
                        {state === "done" ? <Icon.check size={11} /> : state === "active" ? <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terra-bright" /> : i + 1}
                      </span>
                      <span className={`min-w-0 transition-opacity duration-500 ${state === "todo" ? "opacity-45" : "opacity-100"}`}>
                        <span className="block text-[12.5px] font-medium leading-tight text-cream">{s.t}</span>
                        <span className="block text-[11px] text-sand">{s.d}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
              {orch.done && (
                <div className="rise-in mt-4 rounded-none border border-terra/30 bg-terra/10 px-3 py-2.5 text-[12px] text-cream">
                  Sales context moved into delivery, billing and team ownership —{" "}
                  <span className="text-terra-bright">no rekeying.</span>
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <GhostButton onClick={() => setOrch(null)}>Close</GhostButton>
                <GhostButton onClick={reset}>Reset demo</GhostButton>
              </div>
            </div>
          ) : selected ? (
            <div className="os-drawer relative p-4">
              <button
                type="button"
                aria-label="Close"
                onClick={() => setSelectedId(null)}
                className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-none text-sand transition-colors hover:bg-cream/10 hover:text-cream"
              >
                ×
              </button>
              <div className="flex items-center gap-3">
                <Avatar name={selected.name} size={36} />
                <div className="min-w-0">
                  <p className="truncate font-display text-[15px] text-cream">{selected.company}</p>
                  <p className="text-[11.5px] text-sand">{selected.name} · {selected.source}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-none bg-cream/[0.04] px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-sand">Value</p>
                  <p className="font-mono text-[13px] text-cream tabular-nums">{money(selected.value)}</p>
                </div>
                <div className="rounded-none bg-cream/[0.04] px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-sand">Score</p>
                  <ScoreBadge score={selected.score} className="mt-0.5" />
                </div>
              </div>

              <p className="mt-4 text-[10px] uppercase tracking-[0.16em] text-sand">Complete history</p>
              <ul className="mt-2 space-y-1.5 text-[11.5px] text-cream-2">
                {[
                  ["Message", "WhatsApp thread · 14 msgs"],
                  ["Meeting", "Discovery call · 22 min"],
                  ["Proposal", selected.stage === "new" ? "Not yet" : "Opened 2× · last 2h ago"],
                  ["Payment", selected.stage === "won" ? "Deposit paid" : "—"],
                ].map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-3 border-b border-cream/[0.06] pb-1.5 last:border-0">
                    <span className="text-sand">{k}</span>
                    <span className="truncate text-right">{v}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-4 rounded-none border border-terra/25 bg-terra/[0.08] p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-terra-bright">Next-best action</p>
                <p className="mt-1 text-[12.5px] text-cream">{nextBest(selected)}</p>
                <PrimaryButton className="mt-2.5 w-full" onClick={() => doNextBest(selected)}>
                  <Icon.bolt size={13} /> Let the system do it
                </PrimaryButton>
              </div>
            </div>
          ) : null}

        </aside>
      </div>
    </div>
  );
}
