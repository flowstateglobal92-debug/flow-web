"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ModuleId = "pipeline" | "inbox" | "automations" | "finance" | "copilot";

export type OSEvent = {
  id: number;
  /** Which module produced it — drives the icon/colour in the feed. */
  module: ModuleId;
  /** Short, present-tense line: "Deposit invoice prepared for Aria Studio". */
  text: string;
  /** Optional right-hand tag: "+1 project", "Rs 2,400", "00:30". */
  tag?: string;
  tone?: "neutral" | "success" | "warn";
  at: number;
};

type Counters = {
  /** Estimated minutes of admin recovered by everything the visitor has triggered. */
  minutesSaved: number;
  /** Number of automated actions the system has executed in this session. */
  actionsRun: number;
};

type OSState = {
  module: ModuleId;
  setModule: (m: ModuleId) => void;
  events: OSEvent[];
  /** Push an event into the shared activity feed (and toast rail). */
  log: (e: Omit<OSEvent, "id" | "at">, minutes?: number) => void;
  counters: Counters;
};

/**
 * Three contexts, not one. Every `log()` bumps `events` and `counters`, and
 * the Pipeline orchestration alone fires five in ~3.5s — with a single context
 * each of those re-rendered the whole OS subtree including the active module,
 * which is the expensive half. The modules only ever want `log`, and that
 * value never changes, so they now never re-render for someone else's event.
 */
const NavCtx = createContext<Pick<OSState, "module" | "setModule"> | null>(null);
const FeedCtx = createContext<Pick<OSState, "events" | "counters"> | null>(null);
const LogCtx = createContext<OSState["log"] | null>(null);

const SEED: OSEvent[] = [
  { id: 1, module: "inbox", text: "AI rep answered inquiry from Nadia Perera", tag: "00:31", tone: "neutral", at: Date.now() - 82_000 },
  { id: 2, module: "automations", text: "Lead keep-warm · follow-up sent to Cedar & Co", tag: "auto", tone: "neutral", at: Date.now() - 44_000 },
  { id: 3, module: "finance", text: "Invoice #1042 reminder scheduled · due in 2 days", tag: "Rs 3,600", tone: "neutral", at: Date.now() - 12_000 },
];

export function OSProvider({ children }: { children: ReactNode }) {
  const [module, setModule] = useState<ModuleId>("pipeline");
  const [events, setEvents] = useState<OSEvent[]>(SEED);
  const [counters, setCounters] = useState<Counters>({ minutesSaved: 184, actionsRun: 23 });
  const idRef = useRef(100);

  const log = useCallback((e: Omit<OSEvent, "id" | "at">, minutes = 6) => {
    const ev: OSEvent = { ...e, id: idRef.current++, at: Date.now() };
    setEvents((prev) => [ev, ...prev].slice(0, 40));
    setCounters((c) => ({ minutesSaved: c.minutesSaved + minutes, actionsRun: c.actionsRun + 1 }));
  }, []);

  const nav = useMemo(() => ({ module, setModule }), [module]);
  const feed = useMemo(() => ({ events, counters }), [events, counters]);

  return (
    <LogCtx.Provider value={log}>
      <NavCtx.Provider value={nav}>
        <FeedCtx.Provider value={feed}>{children}</FeedCtx.Provider>
      </NavCtx.Provider>
    </LogCtx.Provider>
  );
}

function use<T>(ctx: React.Context<T | null>, name: string): T {
  const v = useContext(ctx);
  if (!v) throw new Error(`${name} must be used inside <OSProvider>`);
  return v;
}

/** The active module and the setter for it. */
export const useOSNav = () => use(NavCtx, "useOSNav");
/** The shared activity feed and the running counters. */
export const useOSFeed = () => use(FeedCtx, "useOSFeed");
/** Push an event into the feed. Stable for the life of the provider. */
export const useOSLog = () => use(LogCtx, "useOSLog");

/** Tiny helper for scripted sequences: await sleep(ms) inside async effects. */
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
