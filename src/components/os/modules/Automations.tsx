"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { sleep, useOS } from "../OSContext";
import { GhostButton, Icon, Pill, PrimaryButton } from "../ui";

/* ───────────── Data ───────────── */
type IconKey = keyof typeof Icon;
type NodeKind = "TRIGGER" | "DECISION" | "ACTION" | "OWNERSHIP";

type FlowNode = { kind: NodeKind; title: string; sub: string; icon: IconKey };

type Playbook = {
  id: string;
  num: string;
  name: string;
  chain: string;
  runs: number;
  /** Text inside the muted "no" branch pill. */
  wait: string;
  nodes: [FlowNode, FlowNode, FlowNode, FlowNode];
  /** One run-log line per node, in order. */
  lines: [string, string, string, string];
};

const PLAYBOOKS: Playbook[] = [
  {
    id: "form",
    num: "01",
    name: "Instant form response",
    chain: "Inquiry → acknowledgement → team alert → CRM",
    runs: 14,
    wait: "hold for review",
    nodes: [
      { kind: "TRIGGER", title: "Inquiry received", sub: "website form · WhatsApp", icon: "inbox" },
      { kind: "DECISION", title: "Real inquiry?", sub: "spam and duplicates filtered", icon: "search" },
      { kind: "ACTION", title: "Acknowledge + alert", sub: "branded reply · team pinged", icon: "send" },
      { kind: "OWNERSHIP", title: "CRM record created", sub: "assigned by territory", icon: "user" },
    ],
    lines: [
      "Trigger fired · Inquiry received (Perera Dental)",
      "Decision · real inquiry → YES",
      "Action · acknowledgement sent · team alerted",
      "Ownership · CRM record → Shahid · reply due 10:00",
    ],
  },
  {
    id: "keepwarm",
    num: "02",
    name: "Lead keep-warm",
    chain: "Welcome → timed follow-ups → reply detection",
    runs: 9,
    wait: "wait 1 day",
    nodes: [
      { kind: "TRIGGER", title: "Lead goes quiet", sub: "no activity · 2 days", icon: "clock" },
      { kind: "DECISION", title: "No reply in 1 day?", sub: "checks inbox + WhatsApp", icon: "inbox" },
      { kind: "ACTION", title: "Value follow-up sent", sub: "WhatsApp · case study", icon: "send" },
      { kind: "OWNERSHIP", title: "Owner notified", sub: "reply detection stays on", icon: "bell" },
    ],
    lines: [
      "Trigger fired · Lead quiet for 2 days (Cedar & Co)",
      "Decision · no reply in 1 day → YES",
      "Action · WhatsApp follow-up sent",
      "Ownership · assigned to Shahid · due tomorrow 10:00",
    ],
  },
  {
    id: "promise",
    num: "03",
    name: "Promise-based follow-up",
    chain: "Requested time → pause → scheduled outreach",
    runs: 6,
    wait: "wait until 15:00",
    nodes: [
      { kind: "TRIGGER", title: "Promise captured", sub: "“call me Thursday 3pm”", icon: "calendar" },
      { kind: "DECISION", title: "Requested time reached?", sub: "respects client timezone", icon: "clock" },
      { kind: "ACTION", title: "Outreach sent", sub: "personalised · context attached", icon: "send" },
      { kind: "OWNERSHIP", title: "Call task created", sub: "owner · Shahid", icon: "user" },
    ],
    lines: [
      "Trigger fired · Promise captured (Lumen Fitness · Thu 15:00)",
      "Decision · requested time reached → YES",
      "Action · WhatsApp message + call reminder sent",
      "Ownership · call task → Shahid · Thu 15:00",
    ],
  },
  {
    id: "proposal",
    num: "04",
    name: "Proposal engagement",
    chain: "Proposal opened → alert → relevant follow-up",
    runs: 4,
    wait: "wait 4 hours",
    nodes: [
      { kind: "TRIGGER", title: "Proposal opened", sub: "private link · 2nd view", icon: "doc" },
      { kind: "DECISION", title: "Opened twice, no reply?", sub: "engagement threshold", icon: "search" },
      { kind: "ACTION", title: "Relevant follow-up sent", sub: "answers likely questions", icon: "send" },
      { kind: "OWNERSHIP", title: "Sales owner alerted", sub: "hot signal · call today", icon: "bell" },
    ],
    lines: [
      "Trigger fired · Proposal opened (Bluefin Logistics)",
      "Decision · opened twice, no reply → YES",
      "Action · follow-up sent · pricing FAQ attached",
      "Ownership · alert → Shahid · call today 16:00",
    ],
  },
  {
    id: "signed",
    num: "05",
    name: "Signed deal onboarding",
    chain: "Signature → project → invoice → kickoff",
    runs: 2,
    wait: "hold · terms review",
    nodes: [
      { kind: "TRIGGER", title: "Proposal signed", sub: "e-signature · timestamped", icon: "check" },
      { kind: "DECISION", title: "Deposit terms set?", sub: "40% on signature", icon: "finance" },
      { kind: "ACTION", title: "Project + invoice created", sub: "milestones · deposit invoice", icon: "doc" },
      { kind: "OWNERSHIP", title: "Kickoff scheduled", sub: "delivery team · 3 tasks", icon: "calendar" },
    ],
    lines: [
      "Trigger fired · Proposal signed (Kite Interiors)",
      "Decision · deposit terms set → YES",
      "Action · project created · deposit invoice sent (Rs 2,880)",
      "Ownership · kickoff → delivery team · Mon 09:30",
    ],
  },
  {
    id: "collect",
    num: "06",
    name: "Invoice collection",
    chain: "Due-date monitor → reminders → escalation",
    runs: 11,
    wait: "wait 1 day",
    nodes: [
      { kind: "TRIGGER", title: "Invoice due tomorrow", sub: "due-date monitor", icon: "finance" },
      { kind: "DECISION", title: "Still unpaid?", sub: "checks bank + gateway", icon: "search" },
      { kind: "ACTION", title: "Reminder sent", sub: "before → on → after due", icon: "bell" },
      { kind: "OWNERSHIP", title: "Escalation queued", sub: "finance owner · day 7", icon: "user" },
    ],
    lines: [
      "Trigger fired · Invoice #1042 due tomorrow (Nova Clinic)",
      "Decision · still unpaid → YES",
      "Action · reminder sent · payment link attached",
      "Ownership · escalation → Finance · day 7 if unpaid",
    ],
  },
];

const EDGE_MS = 560;
const DWELL_MS = 240;
const AUTO_RUN_MS = 6000;

/* ───────────── Geometry ───────────── */
type Rect = { left: number; top: number; right: number; bottom: number; cx: number; cy: number; w: number; h: number };
type Pt = { x: number; y: number };
type Geo = {
  edges: string[];
  yes: Pt;
  branch: { down: string; up: string; noLabel: Pt } | null;
};

const rel = (r: DOMRect, c: DOMRect): Rect => {
  const left = r.left - c.left;
  const top = r.top - c.top;
  return { left, top, right: left + r.width, bottom: top + r.height, cx: left + r.width / 2, cy: top + r.height / 2, w: r.width, h: r.height };
};

const cubicMid = (p0: Pt, p1: Pt, p2: Pt, p3: Pt): Pt => ({
  x: 0.125 * p0.x + 0.375 * p1.x + 0.375 * p2.x + 0.125 * p3.x,
  y: 0.125 * p0.y + 0.375 * p1.y + 0.375 * p2.y + 0.125 * p3.y,
});

/** Edge from node a to node b: horizontal when b sits to the right, otherwise a wrap to the next row. */
function edgeBetween(a: Rect, b: Rect): { d: string; mid: Pt } {
  if (b.left >= a.right - 4) {
    const p0 = { x: a.right, y: a.cy };
    const p3 = { x: b.left, y: b.cy };
    const dx = Math.max(14, (p3.x - p0.x) * 0.55);
    const p1 = { x: p0.x + dx, y: p0.y };
    const p2 = { x: p3.x - dx, y: p3.y };
    return { d: `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`, mid: cubicMid(p0, p1, p2, p3) };
  }
  // Wrap: leave from the source's bottom-left, arrive at the target's top-centre.
  const p0 = { x: a.left + Math.min(22, a.w * 0.18), y: a.bottom };
  const p3 = { x: b.cx, y: b.top };
  const dy = Math.max(24, (p3.y - p0.y) * 0.6);
  const p1 = { x: p0.x, y: p0.y + dy };
  const p2 = { x: p3.x, y: p3.y - dy };
  return { d: `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`, mid: cubicMid(p0, p1, p2, p3) };
}

function buildGeo(nodes: Rect[], wait: Rect | null): Geo {
  const edges: string[] = [];
  let yes: Pt = { x: 0, y: 0 };
  for (let i = 0; i < nodes.length - 1; i++) {
    const e = edgeBetween(nodes[i], nodes[i + 1]);
    edges.push(e.d);
    if (i === 1) yes = e.mid;
  }
  let branch: Geo["branch"] = null;
  const d = nodes[1];
  if (wait) {
    const off = 9;
    const down = `M ${d.cx + off} ${d.bottom} C ${d.cx + off} ${d.bottom + 10}, ${wait.cx + off} ${wait.top - 10}, ${wait.cx + off} ${wait.top}`;
    const up = `M ${wait.cx - off} ${wait.top} C ${wait.cx - off} ${wait.top - 10}, ${d.cx - off} ${d.bottom + 10}, ${d.cx - off} ${d.bottom}`;
    branch = { down, up, noLabel: { x: d.cx + off + 7, y: (d.bottom + wait.top) / 2 + 3 } };
  }
  return { edges, yes, branch };
}

const sameGeo = (a: Geo | null, b: Geo) =>
  !!a &&
  a.edges.join("|") === b.edges.join("|") &&
  a.yes.x === b.yes.x &&
  a.yes.y === b.yes.y &&
  (a.branch?.down ?? "") === (b.branch?.down ?? "") &&
  (a.branch?.up ?? "") === (b.branch?.up ?? "");

/* ───────────── Atoms ───────────── */
function Switch({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full ring-1 transition-[background-color,box-shadow,ring-color] duration-300 disabled:cursor-not-allowed disabled:opacity-50 ${
        on
          ? "bg-terra shadow-[0_0_14px_-2px_rgba(198,93,59,0.75)] ring-terra/60"
          : "bg-cream/[0.08] ring-cream/15 hover:bg-cream/[0.12]"
      }`}
    >
      <span
        className={`absolute left-[2px] h-[14px] w-[14px] rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.5)] transition-[transform,background-color] duration-300 ease-[var(--ease-flow)] ${
          on ? "translate-x-[14px] bg-cream" : "translate-x-0 bg-cream/55"
        }`}
      />
    </button>
  );
}

function FlowNodeCard({
  node,
  lit,
  active,
  disabled,
  cellRef,
  children,
}: {
  node: FlowNode;
  lit: boolean;
  active: boolean;
  disabled: boolean;
  cellRef: (el: HTMLDivElement | null) => void;
  /** Extra absolutely-positioned content anchored to this cell (e.g. the "wait" pill). */
  children?: ReactNode;
}) {
  const I = Icon[node.icon];
  return (
    <div ref={cellRef} className="relative">
      {children}
      <div
        className={`glass-inset relative flex h-full flex-col gap-2.5 p-3 transition-[transform,box-shadow,border-color,background-color] duration-500 ease-[var(--ease-flow)] ${
          disabled ? "" : "hover:-translate-y-0.5"
        } ${
          lit
            ? "border-terra/50 bg-terra/[0.06] shadow-[0_0_0_1px_rgba(198,93,59,0.28),0_0_30px_-6px_rgba(198,93,59,0.6)]"
            : "hover:border-cream/25"
        }`}
      >
        {active && <span className="pointer-events-none absolute -inset-px rounded-none ring-2 ring-terra/40 animate-[pulse-dot_1.2s_ease-out_1]" />}
        <div className="flex items-center justify-between gap-2">
          <span className={`font-mono text-[9.5px] uppercase tracking-[0.18em] transition-colors duration-500 ${lit ? "text-terra-bright" : "text-sand"}`}>
            {node.kind}
          </span>
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-none ring-1 transition-colors duration-500 ${
              lit ? "bg-terra/20 text-terra-bright ring-terra/40" : "bg-cream/[0.04] text-cream-2 ring-cream/10"
            }`}
          >
            <I size={13} />
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium leading-tight text-cream">{node.title}</p>
          <p className="mt-1 text-[10.5px] leading-snug text-sand">{node.sub}</p>
        </div>
      </div>
    </div>
  );
}

/* ───────────── Module ───────────── */
type LogEntry = { id: number; t: string; text: string; kind: "head" | "line" | "done" };

const stamp = (ms: number) => `+${(ms / 1000).toFixed(1)}s`;

export default function Automations() {
  const { log } = useOS();
  const uid = useId().replace(/:/g, "");

  const [selectedId, setSelectedId] = useState<string>(PLAYBOOKS[1].id);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PLAYBOOKS.map((p) => [p.id, true])),
  );
  const [runs, setRuns] = useState<Record<string, number>>(() =>
    Object.fromEntries(PLAYBOOKS.map((p) => [p.id, p.runs])),
  );
  const [running, setRunning] = useState(false);
  const [lit, setLit] = useState(-1); // index of the furthest node lit in the current run
  const [autoRun, setAutoRun] = useState(false);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [geo, setGeo] = useState<Geo | null>(null);

  const playbook = useMemo(() => PLAYBOOKS.find((p) => p.id === selectedId) ?? PLAYBOOKS[0], [selectedId]);
  const isOn = enabled[playbook.id];

  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeEls = useRef<(HTMLDivElement | null)[]>([]);
  const waitRef = useRef<HTMLDivElement>(null);
  const edgeEls = useRef<(SVGPathElement | null)[]>([]);
  const pulseRef = useRef<SVGGElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const runToken = useRef(0);
  const entryId = useRef(0);
  const runningRef = useRef(false);

  /* Measure nodes → edges. Robust at any container width. */
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => {
      const c = el.getBoundingClientRect();
      if (c.width === 0) return;
      const rects: Rect[] = [];
      for (const n of nodeEls.current) {
        if (!n) return;
        rects.push(rel(n.getBoundingClientRect(), c));
      }
      if (rects.length < 4) return;
      const wait = waitRef.current ? rel(waitRef.current.getBoundingClientRect(), c) : null;
      const next = buildGeo(rects, wait);
      setGeo((prev) => (sameGeo(prev, next) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    nodeEls.current.forEach((n) => n && ro.observe(n));
    if (waitRef.current) ro.observe(waitRef.current);
    return () => ro.disconnect();
  }, [selectedId]);

  const pushEntry = useCallback((e: Omit<LogEntry, "id">) => {
    setEntries((prev) => [...prev, { ...e, id: ++entryId.current }].slice(-40));
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const hidePulse = () => {
    const g = pulseRef.current;
    if (g) g.style.opacity = "0";
  };

  const travel = useCallback((path: SVGPathElement | null, dur: number, token: number) => {
    return new Promise<void>((resolve) => {
      const g = pulseRef.current;
      if (!path || !g || dur <= 0) {
        resolve();
        return;
      }
      const len = path.getTotalLength();
      const start = performance.now();
      g.style.opacity = "1";
      const frame = (now: number) => {
        if (runToken.current !== token) {
          resolve();
          return;
        }
        const t = Math.min(1, (now - start) / dur);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const p = path.getPointAtLength(e * len);
        g.setAttribute("transform", `translate(${p.x} ${p.y})`);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current || !enabled[playbook.id]) return;
    const token = ++runToken.current;
    const pb = playbook;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const edgeMs = reduced ? 0 : EDGE_MS;
    const dwellMs = reduced ? 120 : DWELL_MS;

    runningRef.current = true;
    setRunning(true);
    setLit(0);
    const t0 = performance.now();
    pushEntry({ t: "run", text: `${pb.name} · #${(runs[pb.id] ?? 0) + 1}`, kind: "head" });
    pushEntry({ t: stamp(0), text: pb.lines[0], kind: "line" });

    // Place the pulse on the first node before it moves.
    const first = edgeEls.current[0];
    const g = pulseRef.current;
    if (first && g) {
      const p = first.getPointAtLength(0);
      g.setAttribute("transform", `translate(${p.x} ${p.y})`);
      g.style.opacity = "1";
    }
    await sleep(dwellMs);
    if (runToken.current !== token) return;

    for (let i = 0; i < 3; i++) {
      await travel(edgeEls.current[i], edgeMs, token);
      if (runToken.current !== token) return;
      setLit(i + 1);
      pushEntry({ t: stamp(performance.now() - t0), text: pb.lines[i + 1], kind: "line" });
      await sleep(dwellMs);
      if (runToken.current !== token) return;
    }

    const total = performance.now() - t0;
    hidePulse();
    setRuns((prev) => ({ ...prev, [pb.id]: (prev[pb.id] ?? 0) + 1 }));
    pushEntry({ t: stamp(total), text: `Complete · 4 steps · exceptions routed to a person`, kind: "done" });
    log({ module: "automations", text: `${pb.name} · action executed`, tag: "auto" }, 8);
    runningRef.current = false;
    setRunning(false);

    await sleep(900);
    if (runToken.current !== token) return;
    setLit(-1);
  }, [enabled, playbook, runs, pushEntry, travel, log]);

  const runLatest = useRef(run);
  useEffect(() => {
    runLatest.current = run;
  }, [run]);

  /* Auto-run: one pulse every ~6s while on. */
  useEffect(() => {
    if (!autoRun) return;
    const kick = () => void runLatest.current();
    kick();
    const id = setInterval(kick, AUTO_RUN_MS);
    return () => clearInterval(id);
  }, [autoRun]);

  /* Cancel any in-flight run on unmount. */
  useEffect(() => {
    const token = runToken;
    return () => {
      token.current++;
    };
  }, []);

  const cancelRun = () => {
    runToken.current++;
    runningRef.current = false;
    setRunning(false);
    setLit(-1);
    hidePulse();
  };

  const select = (id: string) => {
    if (id === selectedId) return;
    cancelRun();
    setSelectedId(id);
  };

  const toggle = (id: string, next: boolean) => {
    setEnabled((prev) => ({ ...prev, [id]: next }));
    const pb = PLAYBOOKS.find((p) => p.id === id);
    if (id === selectedId && !next) {
      cancelRun();
      setAutoRun(false);
    }
    log(
      { module: "automations", text: `${pb?.name ?? "Playbook"} · ${next ? "switched on" : "paused"}`, tag: next ? "live" : "paused", tone: next ? "neutral" : "warn" },
      0,
    );
  };

  const clearLog = () => setEntries([]);

  const status = !isOn ? "Paused" : running ? "Running" : autoRun ? "Auto" : "Ready";

  return (
    <div className="flex h-full flex-col p-4 sm:p-5">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-medium text-cream sm:text-lg">Automations</h3>
            <Pill tone="terra">
              <Icon.automations size={11} /> No-code
            </Pill>
          </div>
          <p className="mt-1 text-[12.5px] text-sand">
            <span className="text-cream-2">Pick a playbook, then run it.</span> Routine steps run automatically — approvals stay
            human-owned.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer select-none items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-sand">
            <Switch on={autoRun} onChange={setAutoRun} label="Auto-run" disabled={!isOn} />
            <span className={autoRun ? "text-terra-bright" : ""}>Auto-run</span>
          </label>
          <PrimaryButton onClick={() => void run()} disabled={!isOn || running}>
            <Icon.play size={13} /> Run once
          </PrimaryButton>
        </div>
      </div>

      {/* Body — container queries keep the layout robust at any width */}
      <div className="@container flex min-h-0 flex-1 flex-col">
        <div className="flex flex-col gap-3 @2xl:flex-row">
          {/* Playbook list */}
          <aside className="shrink-0 @2xl:w-[230px]">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[10px] uppercase tracking-[0.16em] text-sand">Playbooks</span>
              <span className="font-mono text-[10px] text-sand tabular-nums">
                {Object.values(enabled).filter(Boolean).length}/{PLAYBOOKS.length} on
              </span>
            </div>
            <div className="scroll-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 @2xl:mx-0 @2xl:flex-col @2xl:overflow-visible @2xl:px-0 @2xl:pb-0" data-lenis-prevent>
              {PLAYBOOKS.map((p) => {
                const on = enabled[p.id];
                const sel = p.id === selectedId;
                return (
                  <div
                    key={p.id}
                    className={`flex w-[236px] shrink-0 items-stretch gap-2 rounded-none border px-3 py-2.5 transition-[border-color,background-color,box-shadow] duration-300 @2xl:w-auto ${
                      sel
                        ? "border-terra/50 bg-cream/[0.06] shadow-[0_0_0_1px_rgba(198,93,59,0.25)]"
                        : "border-cream/10 bg-cream/[0.035] hover:border-cream/25 hover:bg-cream/[0.06]"
                    }`}
                  >
                    <button type="button" onClick={() => select(p.id)} className="min-w-0 flex-1 text-left" aria-pressed={sel}>
                      <span className="flex items-center gap-2">
                        <span className={`font-mono text-[10px] tabular-nums ${sel ? "text-terra-bright" : "text-sand"}`}>{p.num}</span>
                        <span className={`truncate text-[12.5px] font-medium leading-tight transition-colors ${on ? "text-cream" : "text-cream/50"}`}>
                          {p.name}
                        </span>
                      </span>
                      <span className={`mt-1 block truncate text-[10.5px] leading-snug transition-colors ${on ? "text-sand" : "text-sand/50"}`}>{p.chain}</span>
                      <span className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-sand">
                        <span className={`h-1 w-1 rounded-full ${on ? "bg-terra-bright" : "bg-cream/20"}`} />
                        <span className={on ? "text-cream-2" : "text-sand/60"}>{runs[p.id]}</span> runs today
                      </span>
                    </button>
                    <div className="flex flex-col items-end justify-between py-0.5">
                      <Switch on={on} onChange={(v) => toggle(p.id, v)} label={`${p.name} ${on ? "on" : "off"}`} />
                      <span className={`font-mono text-[9px] uppercase tracking-[0.14em] ${on ? "text-terra-bright/80" : "text-sand/60"}`}>
                        {on ? "on" : "off"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>

          {/* Canvas + run log */}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="relative overflow-hidden rounded-none border border-cream/[0.07] bg-ink/25 p-4 sm:p-5">
              <div
                className={`glow-terra pointer-events-none absolute -left-16 -top-24 h-64 w-64 transition-opacity duration-700 ${
                  !isOn ? "opacity-0" : running ? "opacity-50" : "opacity-20"
                }`}
              />
              <div className="relative mb-4 flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.16em] text-sand">
                  <span className="text-cream-2">Playbook {playbook.num}</span> · {playbook.name}
                </span>
                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] ring-1 ${
                    !isOn
                      ? "bg-cream/5 text-sand ring-cream/15"
                      : running || autoRun
                        ? "bg-terra/15 text-terra-bright ring-terra/35"
                        : "bg-emerald-400/10 text-emerald-200 ring-emerald-300/25"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${!isOn ? "bg-cream/30" : running ? "pulse-dot bg-terra-bright" : autoRun ? "bg-terra-bright" : "bg-emerald-300"}`} />
                  {status.toUpperCase()}
                </span>
              </div>

              {/* Graph */}
              <div
                ref={canvasRef}
                className={`relative transition-[opacity,filter] duration-500 ${isOn ? "" : "opacity-40 grayscale"}`}
              >
                <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
                  <defs>
                    <filter id={`${uid}-glow`} x="-200%" y="-200%" width="500%" height="500%">
                      <feGaussianBlur stdDeviation="4" />
                    </filter>
                  </defs>
                  {geo?.edges.map((d, i) => (
                    <g key={i}>
                      <path d={d} fill="none" stroke="rgba(243,233,220,0.08)" strokeWidth={1.5} />
                      <path
                        ref={(el) => {
                          edgeEls.current[i] = el;
                        }}
                        d={d}
                        fill="none"
                        className="flow-dash transition-[stroke] duration-500"
                        stroke={i < lit ? "rgba(224,120,79,0.85)" : "rgba(243,233,220,0.28)"}
                        strokeWidth={1.5}
                        strokeLinecap="round"
                      />
                    </g>
                  ))}
                  {geo?.branch && (
                    <g>
                      <path d={geo.branch.down} fill="none" className="flow-dash" stroke="rgba(243,233,220,0.2)" strokeWidth={1.2} strokeLinecap="round" />
                      <path d={geo.branch.up} fill="none" stroke="rgba(243,233,220,0.14)" strokeWidth={1.2} strokeLinecap="round" strokeDasharray="2 4" />
                      <text
                        x={geo.branch.noLabel.x}
                        y={geo.branch.noLabel.y}
                        className="fill-sand font-mono text-[9px] uppercase tracking-[0.16em]"
                      >
                        no
                      </text>
                    </g>
                  )}
                  {geo && (
                    <g>
                      <rect x={geo.yes.x - 15} y={geo.yes.y - 15} width={30} height={14} rx={7} className="fill-ink-3" />
                      <text
                        x={geo.yes.x}
                        y={geo.yes.y - 5}
                        textAnchor="middle"
                        className={`font-mono text-[9px] uppercase tracking-[0.16em] transition-colors duration-500 ${lit >= 2 ? "fill-terra-bright" : "fill-sand"}`}
                      >
                        yes
                      </text>
                    </g>
                  )}
                  {/* Travelling pulse */}
                  <g ref={pulseRef} style={{ opacity: 0, transition: "opacity 0.3s" }}>
                    <circle r={10} fill="rgba(198,93,59,0.55)" filter={`url(#${uid}-glow)`} />
                    <circle r={4} fill="#e0784f" />
                    <circle r={4} fill="none" stroke="rgba(243,233,220,0.6)" strokeWidth={1} />
                  </g>
                </svg>

                <div className="grid grid-cols-2 gap-x-6 gap-y-[76px] pb-[68px] @2xl:grid-cols-4 @2xl:gap-x-7 @2xl:gap-y-0">
                  {playbook.nodes.map((n, i) => (
                    <FlowNodeCard
                      key={`${playbook.id}-${n.kind}`}
                      node={n}
                      lit={isOn && i <= lit}
                      active={isOn && running && i === lit}
                      disabled={!isOn}
                      cellRef={(el) => {
                        nodeEls.current[i] = el;
                      }}
                    >
                      {/* "no" branch pill — hangs under the DECISION node; anchored to its cell so it never occupies a grid slot */}
                      {i === 1 && (
                        <div ref={waitRef} className="pointer-events-none absolute left-1/2 top-[calc(100%+22px)] w-max -translate-x-1/2">
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-cream/10 bg-cream/[0.03] px-2.5 py-1 font-mono text-[10px] text-sand">
                            <Icon.clock size={11} className="opacity-70" />
                            {playbook.wait}
                          </span>
                        </div>
                      )}
                    </FlowNodeCard>
                  ))}
                </div>

                {!isOn && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="glass glass--strong rounded-full px-3.5 py-1.5 text-[11.5px] text-cream-2 shadow-2xl">
                      Playbook paused — switch it on to run.
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Run log */}
            <div className="flex min-h-0 flex-col rounded-none border border-cream/[0.07] bg-ink/25">
              <div className="flex items-center justify-between gap-3 border-b border-cream/[0.06] px-4 py-2.5">
                <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-sand">
                  <span className={`h-1.5 w-1.5 rounded-full ${running ? "pulse-dot bg-terra-bright" : "bg-cream/20"}`} />
                  Run log
                </span>
                <div className="flex items-center gap-2">
                  <span className="hidden font-mono text-[10px] text-sand tabular-nums sm:inline">{entries.length} lines</span>
                  <GhostButton onClick={clearLog} disabled={!entries.length} className="!px-2.5 !py-1 !text-[11px]">
                    Clear
                  </GhostButton>
                </div>
              </div>
              <div ref={logRef} className="scroll-thin max-h-[150px] overflow-y-auto px-4 py-2.5" data-lenis-prevent>
                {entries.length === 0 ? (
                  <p className="py-3 text-center font-mono text-[11px] text-sand/70">
                    No runs yet — press <span className="text-cream-2">Run once</span> or switch on Auto-run.
                  </p>
                ) : (
                  <ul className="space-y-1 font-mono text-[11px] leading-relaxed">
                    {entries.map((e) => (
                      <li key={e.id} className={`rise-in flex gap-3 ${e.kind === "head" ? "mt-2 first:mt-0" : ""}`}>
                        <span className={`w-12 shrink-0 tabular-nums ${e.kind === "head" ? "text-terra-bright" : "text-sand"}`}>
                          {e.kind === "head" ? "▸ run" : e.t}
                        </span>
                        <span
                          className={`min-w-0 flex-1 truncate ${
                            e.kind === "head" ? "text-cream" : e.kind === "done" ? "text-emerald-200/80" : "text-cream-2"
                          }`}
                        >
                          {e.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer note */}
        <p className="mt-3 flex items-center gap-2 border-t border-cream/[0.06] pt-3 text-[11px] text-sand">
          <Icon.user size={12} className="text-terra-bright/80" />
          Exceptions and approvals are routed to a person.
        </p>
      </div>
    </div>
  );
}
