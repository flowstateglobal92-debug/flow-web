"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { sleep, useOS } from "../OSContext";
import { Avatar, GhostButton, Icon, Pill, ScoreBadge, type Score } from "../ui";

/* ───────────── Data ───────────── */
type Lang = "EN" | "SI" | "TA";
type Stage = "open" | "qualified" | "awaiting-slot" | "booked" | "handed-off";
type CheckState = "idle" | "reviewing" | "done";

type Msg = {
  id: number;
  from: "customer" | "ai" | "system";
  text: string;
  /** Milliseconds relative to the session base (negative = before the visitor arrived). */
  at: number;
  /** Typewriter still pending — cleared once the bubble has finished typing. */
  animate?: boolean;
  card?: "check";
  slots?: boolean;
};

type Conv = {
  id: string;
  name: string;
  business: string;
  domain: string;
  lang: Lang;
  loadTime: string;
  mobileScore: number;
  issues: string[];
  slots: [string, string];
  msgs: Msg[];
  stage: Stage;
  score: Score;
  intent: string | null;
  booked: string | null;
  handoff: string | null;
  check: CheckState;
  unread: boolean;
  busy: boolean;
  lastAt: string;
};

const LANG_META: Record<Lang, { chip: string; label: string }> = {
  EN: { chip: "EN", label: "English" },
  SI: { chip: "සිං", label: "Sinhala · English" },
  TA: { chip: "தமிழ்", label: "Tamil · English" },
};

const OWNER = "Shahid";

const QUICK_PROMPTS = [
  "Hi, is our website slow? Do you fix that?",
  "How much for a booking system?",
  "Can someone call me tomorrow at 4pm?",
];

const GENERIC_REPLIES = [
  "Noted — I've added that to your profile. Anything else before your call?",
  "Got it, that's on file for the call. Anything else I can sort out in the meantime?",
  "Added to your notes so nothing gets lost. Is there anything else you'd like covered?",
];

type Seed = Omit<Conv, "msgs" | "stage" | "score" | "intent" | "booked" | "handoff" | "check" | "busy"> & {
  opener: string;
  greeting: string;
  seedAt: number;
};

const SEEDS: Seed[] = [
  {
    id: "nadia",
    name: "Nadia Perera",
    business: "Perera Dental",
    domain: "pereradental.lk",
    lang: "EN",
    loadTime: "6.4s",
    mobileScore: 41,
    issues: ["No online booking", "Not mobile-friendly", "Outdated pages"],
    slots: ["Thu 16:00", "Fri 10:30"],
    opener: "Hi, is this the web studio?",
    greeting: "Hi Nadia — yes, you've reached us. I'm the studio's AI assistant, on 24/7. How can I help today?",
    seedAt: -4 * 60_000,
    unread: false,
    lastAt: "4m",
  },
  {
    id: "ishara",
    name: "Ishara Silva",
    business: "Lumen Fitness",
    domain: "lumenfitness.lk",
    lang: "SI",
    loadTime: "5.1s",
    mobileScore: 48,
    issues: ["No class booking", "Slow on mobile", "Missing contact form"],
    slots: ["Wed 11:00", "Thu 15:30"],
    opener: "ආයුබෝවන්, ඔයාලා වෙබ් සයිට් හදනවද?",
    greeting: "ආයුබෝවන් Ishara — ඔව්, අපි කරනවා. Happy to continue in Sinhala or English. How can I help today?",
    seedAt: -9 * 60_000,
    unread: true,
    lastAt: "9m",
  },
  {
    id: "arjun",
    name: "Arjun Raj",
    business: "Raj Textiles",
    domain: "rajtextiles.lk",
    lang: "TA",
    loadTime: "7.2s",
    mobileScore: 36,
    issues: ["No product catalogue", "Not mobile-friendly", "Broken enquiry form"],
    slots: ["Thu 10:00", "Fri 14:00"],
    opener: "வணக்கம், உங்கள் விலை என்ன?",
    greeting: "வணக்கம் Arjun — thanks for reaching out. Happy to continue in Tamil or English. What would you like to build?",
    seedAt: -14 * 60_000,
    unread: true,
    lastAt: "14m",
  },
  {
    id: "maya",
    name: "Maya Fernando",
    business: "Aria Studio",
    domain: "ariastudio.lk",
    lang: "EN",
    loadTime: "4.8s",
    mobileScore: 52,
    issues: ["No online booking", "Slow image loading", "No payment link"],
    slots: ["Wed 09:30", "Thu 17:00"],
    opener: "Hello — do you build sites with online booking?",
    greeting: "Hi Maya — we do, and it's one of our most requested builds. Tell me a little about the studio and I'll point you the right way.",
    seedAt: -27 * 60_000,
    unread: true,
    lastAt: "27m",
  },
];

const TIMELINE = [
  { t: "Inquiry received", tag: "00:00" },
  { t: "AI responds & qualifies", tag: "00:31" },
  { t: "In chat · audit & fit", tag: "live" },
  { t: "Booked · slot & reminders", tag: "auto" },
  { t: "Handoff · full context", tag: "team" },
];

const SCORE_FILL: Record<Score, string> = { COLD: "22%", WARM: "58%", HOT: "100%" };
const SCORE_ORDER: Score[] = ["COLD", "WARM", "HOT"];

function buildConv(s: Seed): Conv {
  const { opener, greeting, seedAt, ...rest } = s;
  return {
    ...rest,
    msgs: [
      { id: 1, from: "customer", text: opener, at: seedAt },
      { id: 2, from: "ai", text: greeting, at: seedAt + 28_000 },
    ],
    stage: "open",
    score: "COLD",
    intent: null,
    booked: null,
    handoff: null,
    check: "idle",
    busy: false,
  };
}

const initialConvs = (): Record<string, Conv> =>
  Object.fromEntries(SEEDS.map((s) => [s.id, buildConv(s)]));

const rand = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const firstName = (n: string) => n.split(" ")[0];
const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/* ───────────── Script ───────────── */
type Intent = { label: string; ack: string; pricing: boolean };

function detectIntent(text: string): Intent {
  const t = text.toLowerCase();
  if (/slow|speed|load|fast|website/.test(t))
    return {
      label: "Website speed · rebuild",
      ack: "Yes — slow sites are exactly what we fix, and they usually cost more enquiries than people realise.",
      pricing: /price|cost|how much|quote/.test(t),
    };
  if (/book|schedul|appoint|price|cost|how much|quote/.test(t))
    return {
      label: "Booking system · pricing",
      ack: "We do — online booking is one of our most requested builds, and I can give you a clear range once I know a little more.",
      pricing: true,
    };
  if (/call|tomorrow|phone|ring|talk|speak/.test(t))
    return {
      label: "Requested a call",
      ack: "Of course — I can set that up right now. Let me make sure whoever calls has the right context first.",
      pricing: false,
    };
  return {
    label: "General inquiry",
    ack: "Thanks for the detail — happy to help.",
    pricing: false,
  };
}

const reply1 = (c: Conv, intent: Intent) =>
  `${intent.ack} I've run a live check on ${c.domain} while we chat — results below. One quick question so I route this well: roughly how many enquiries a week does ${c.business} get through the site today?`;

const reply2 = (c: Conv, pricing: boolean) =>
  `Understood — that's useful. Based on the check, here's the fit: a lean rebuild of ${c.domain} focused on speed and mobile, with online booking wired straight into your calendar. For a business your size that's typically a 3–4 week build${
    pricing ? ", landing in the Rs 1,800–3,200 range depending on scope" : ", and I'll have exact pricing ready for you on the call"
  }. The best next step is a 15-minute scoping call with ${OWNER}. Two slots are free — tap one and I'll book it:`;

const replyNudge = (c: Conv) =>
  `No problem, ${firstName(c.name)} — I've noted that. Whenever you're ready, tap a slot and I'll lock it in, or tell me a time that suits and I'll check ${OWNER}'s calendar:`;

const reply3 = (c: Conv, slot: string) =>
  `Booked — ${slot} with ${OWNER}. The calendar invite is on its way to your WhatsApp, with a reminder an hour before. He'll join with the full context of this chat, so you won't need to repeat a thing. Speak then, ${firstName(c.name)}.`;

/* ───────────── Atoms ───────────── */
function Typewriter({ text, animate, onDone, onGrow }: { text: string; animate: boolean; onDone: () => void; onGrow: () => void }) {
  const [n, setN] = useState(animate ? 0 : text.length);
  const doneRef = useRef(onDone);
  const growRef = useRef(onGrow);
  useEffect(() => {
    doneRef.current = onDone;
    growRef.current = onGrow;
  });

  useEffect(() => {
    if (!animate) return;
    // Reduced motion: reveal the whole message on the first tick instead of per character.
    const step = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? text.length : 1;
    let i = 0;
    const id = setInterval(() => {
      i = Math.min(text.length, i + step);
      setN(i);
      growRef.current();
      if (i >= text.length) {
        clearInterval(id);
        doneRef.current();
      }
    }, 12);
    return () => clearInterval(id);
  }, [animate, text]);

  const shown = animate ? text.slice(0, n) : text;
  return (
    <>
      {shown}
      {animate && n < text.length && <span className="caret ml-px inline-block h-[1em] w-[2px] translate-y-[2px] bg-terra-bright" />}
    </>
  );
}

function TypingDots() {
  return (
    <div className="flex justify-end">
      <div className="inline-flex items-center gap-1 rounded-none bg-terra/[0.14] px-3 py-2.5 ring-1 ring-terra/20">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-terra-bright"
            style={{ animationDelay: `${i * 160}ms`, animationDuration: "1.1s" }}
          />
        ))}
      </div>
    </div>
  );
}

function SiteCheckCard({ conv }: { conv: Conv }) {
  const reviewing = conv.check !== "done";
  return (
    <div className="mt-2.5 rounded-none border border-cream/10 bg-ink/50 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-sand">
          <Icon.search size={11} /> Live website check
        </span>
        <span className="truncate font-mono text-[10px] text-cream-2">{conv.domain}</span>
      </div>

      {reviewing ? (
        <div className="mt-2.5 space-y-2" aria-live="polite">
          {[100, 72, 86].map((w, i) => (
            <div key={i} className="relative h-2 overflow-hidden rounded-full bg-cream/[0.06]" style={{ width: `${w}%` }}>
              <div className="shimmer absolute inset-0" />
            </div>
          ))}
          <p className="flex items-center gap-1.5 pt-0.5 font-mono text-[10px] text-sand">
            <span className="pulse-dot h-1 w-1 rounded-full bg-terra-bright" /> reviewing…
          </p>
        </div>
      ) : (
        <div className="rise-in mt-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-cream/[0.04] px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-[0.14em] text-sand">Load time</p>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="font-display text-[15px] text-cream tabular-nums">{conv.loadTime}</span>
                <span className="rounded-full bg-amber-400/10 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.1em] text-amber-200 ring-1 ring-amber-300/25">
                  flagged
                </span>
              </div>
            </div>
            <div className="rounded-lg bg-cream/[0.04] px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-[0.14em] text-sand">Mobile score</p>
              <p className="mt-0.5 font-display text-[15px] text-cream tabular-nums">
                {conv.mobileScore}
                <span className="text-[11px] text-sand">/100</span>
              </p>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-cream/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-terra-deep to-terra transition-all duration-700 ease-[var(--ease-flow)]"
                  style={{ width: `${conv.mobileScore}%` }}
                />
              </div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10px] text-terra-bright">{conv.issues.length} issues found</span>
            {conv.issues.map((x) => (
              <span key={x} className="rounded-full bg-cream/[0.05] px-2 py-px text-[10.5px] text-cream-2 ring-1 ring-cream/10">
                {x}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, filled, children }: { label: string; value?: string | null; filled?: boolean; children?: ReactNode }) {
  const isFilled = filled ?? !!value;
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-cream/[0.06] py-1.5 last:border-0">
      <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-sand">{label}</span>
      {children ?? (
        <span
          key={value ?? "empty"}
          className={`min-w-0 truncate text-right text-[11.5px] transition-colors duration-500 ${
            isFilled ? "rise-in text-cream" : "text-sand/50"
          }`}
        >
          {value ?? "—"}
        </span>
      )}
    </li>
  );
}

function ScoreMeter({ score }: { score: Score }) {
  return (
    <div className="mt-3 rounded-none bg-cream/[0.04] px-3 py-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.16em] text-sand">Lead score</p>
        <ScoreBadge score={score} />
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cream/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cream/40 via-terra to-terra-bright transition-all duration-700 ease-[var(--ease-flow)]"
          style={{ width: SCORE_FILL[score] }}
        />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[9.5px] tracking-[0.14em]">
        {SCORE_ORDER.map((s) => (
          <span
            key={s}
            className={`transition-colors duration-500 ${
              s === score ? "text-terra-bright" : SCORE_ORDER.indexOf(s) < SCORE_ORDER.indexOf(score) ? "text-cream-2" : "text-sand/50"
            }`}
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

const stageDone = (s: Stage) => ({ open: 1, qualified: 2, "awaiting-slot": 3, booked: 4, "handed-off": 5 })[s];

/* ───────────── Module ───────────── */
export default function Inbox() {
  const { log } = useOS();
  const [convs, setConvs] = useState<Record<string, Conv>>(initialConvs);
  const [activeId, setActiveId] = useState<string>(SEEDS[0].id);
  const [draft, setDraft] = useState("");
  const [base, setBase] = useState<number | null>(null);
  const runRef = useRef<Record<string, number>>({});
  const msgId = useRef(100);
  const genericIdx = useRef(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Session clock base — set on the client only, so seeded timestamps never mismatch SSR.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only clock base, intentionally after hydration
    setBase(Date.now());
  }, []);
  const now = useCallback(() => (base == null ? 0 : Date.now() - base), [base]);

  const conv = convs[activeId];

  const patch = useCallback((id: string, fn: (c: Conv) => Conv) => {
    setConvs((prev) => (prev[id] ? { ...prev, [id]: fn(prev[id]) } : prev));
  }, []);

  const push = useCallback(
    (id: string, m: Omit<Msg, "id" | "at">) => {
      const msg: Msg = { ...m, id: msgId.current++, at: now() };
      patch(id, (c) => ({ ...c, msgs: [...c.msgs, msg], lastAt: "now" }));
      return msg.id;
    },
    [now, patch],
  );

  const scrollToEnd = useCallback(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const markTyped = useCallback(
    (convId: string, id: number) =>
      patch(convId, (c) => ({ ...c, msgs: c.msgs.map((m) => (m.id === id ? { ...m, animate: false } : m)) })),
    [patch],
  );

  const alive = (id: string, run: number) => runRef.current[id] === run;

  const send = useCallback(
    async (text: string, slot?: string) => {
      const c = convs[activeId];
      const clean = text.trim();
      if (!c || c.busy || !clean) return;
      const id = c.id;
      const run = (runRef.current[id] ?? 0) + 1;
      runRef.current[id] = run;
      const stage = c.stage;
      const first = firstName(c.name);

      push(id, { from: "customer", text: clean });
      patch(id, (x) => ({ ...x, busy: true, unread: false }));

      const done = () => patch(id, (x) => ({ ...x, busy: false }));

      if (stage === "open") {
        const intent = detectIntent(clean);
        patch(id, (x) => ({ ...x, intent: intent.label }));
        await sleep(rand(700, 1400));
        if (!alive(id, run)) return;
        push(id, { from: "ai", text: reply1(c, intent), animate: true, card: "check" });
        patch(id, (x) => ({ ...x, stage: "qualified", score: "WARM", check: "reviewing", busy: false }));
        log({ module: "inbox", text: `AI rep replied to ${c.name} in 31s`, tag: "00:31" }, 8);
        await sleep(2200);
        if (!alive(id, run)) return;
        patch(id, (x) => ({ ...x, check: "done" }));
        log({ module: "inbox", text: `Live website check · ${c.domain} · ${c.loadTime} flagged`, tag: `${c.issues.length} issues` }, 6);
        return;
      }

      if (stage === "qualified") {
        const pricing = /price|cost|how much|quote|budget/.test(clean.toLowerCase()) || (c.intent ?? "").includes("pricing");
        await sleep(rand(800, 1400));
        if (!alive(id, run)) return;
        push(id, { from: "ai", text: reply2(c, pricing), animate: true, slots: true });
        patch(id, (x) => ({ ...x, stage: "awaiting-slot", busy: false, intent: pricing && !(x.intent ?? "").includes("pricing") ? `${x.intent} · pricing` : x.intent }));
        log({ module: "inbox", text: `Fit proposed · 2 call slots offered to ${first}`, tag: "qualified" }, 8);
        return;
      }

      if (stage === "awaiting-slot") {
        if (slot) {
          await sleep(rand(600, 1000));
          if (!alive(id, run)) return;
          push(id, { from: "ai", text: reply3(c, slot), animate: true });
          patch(id, (x) => ({ ...x, stage: "booked", score: "HOT", booked: slot, busy: false }));
          log({ module: "inbox", text: `Call booked · ${slot} · reminders scheduled`, tag: "calendar", tone: "success" }, 10);
          await sleep(2600);
          if (!alive(id, run)) return;
          push(id, { from: "system", text: "Handed off to team · full context attached" });
          patch(id, (x) => ({ ...x, stage: "handed-off", handoff: OWNER }));
          log({ module: "automations", text: `${c.name} handed to ${OWNER} · full chat context attached`, tag: "handoff", tone: "success" }, 12);
          return;
        }
        await sleep(rand(600, 1200));
        if (!alive(id, run)) return;
        push(id, { from: "ai", text: replyNudge(c), animate: true, slots: true });
        done();
        log({ module: "inbox", text: `Note saved · ${first} nudged to pick a slot`, tag: "follow-up" }, 6);
        return;
      }

      // booked / handed-off — graceful generic line.
      await sleep(rand(600, 1200));
      if (!alive(id, run)) return;
      const line = GENERIC_REPLIES[genericIdx.current++ % GENERIC_REPLIES.length];
      push(id, { from: "ai", text: line, animate: true });
      done();
      log({ module: "inbox", text: `Note added to ${c.name}'s profile before the call`, tag: "profile" }, 6);
    },
    [activeId, convs, log, patch, push],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    void send(draft);
    setDraft("");
  };

  const reset = () => {
    const seed = SEEDS.find((s) => s.id === activeId);
    if (!seed) return;
    runRef.current[activeId] = (runRef.current[activeId] ?? 0) + 1;
    setConvs((prev) => ({ ...prev, [activeId]: { ...buildConv(seed), unread: false } }));
    setDraft("");
  };

  const select = (id: string) => {
    setActiveId(id);
    patch(id, (c) => ({ ...c, unread: false }));
  };

  // Keep the newest message in view.
  useLayoutEffect(() => {
    scrollToEnd();
  }, [conv.msgs.length, conv.busy, conv.check, activeId, scrollToEnd]);

  const list = useMemo(() => SEEDS.map((s) => convs[s.id]).filter(Boolean), [convs]);
  const doneSteps = stageDone(conv.stage);
  const scripted = conv.stage === "handed-off";
  const langLabel = LANG_META[conv.lang];

  const ConvChip = ({ c, compact }: { c: Conv; compact?: boolean }) => {
    const active = c.id === activeId;
    const last = c.msgs[c.msgs.length - 1];
    return (
      <button
        type="button"
        onClick={() => select(c.id)}
        aria-current={active ? "true" : undefined}
        className={`group relative flex shrink-0 items-center gap-2.5 rounded-none border text-left transition-all ${
          compact ? "px-2.5 py-1.5" : "w-full p-2.5"
        } ${active ? "border-terra/40 bg-terra/[0.08]" : "border-cream/[0.08] bg-cream/[0.03] hover:border-cream/20 hover:bg-cream/[0.05]"}`}
      >
        <span className="relative">
          <Avatar name={c.name} size={compact ? 26 : 30} />
          {c.unread && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-terra-bright ring-2 ring-ink-2" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={`truncate text-[12.5px] font-medium leading-tight ${active ? "text-cream" : "text-cream-2"}`}>
              {compact ? firstName(c.name) : c.name}
            </span>
            <span className="shrink-0 rounded-full bg-cream/[0.06] px-1.5 py-px font-mono text-[9.5px] text-sand ring-1 ring-cream/10">
              {LANG_META[c.lang].chip}
            </span>
          </span>
          {!compact && (
            <span className="mt-0.5 flex items-center justify-between gap-2">
              <span className={`min-w-0 truncate text-[10.5px] ${c.unread ? "text-cream-2" : "text-sand"}`}>
                {last.from === "ai" ? "AI rep: " : last.from === "system" ? "" : ""}
                {last.text}
              </span>
              <span className="shrink-0 font-mono text-[9.5px] text-sand tabular-nums">{c.lastAt}</span>
            </span>
          )}
        </span>
      </button>
    );
  };

  return (
    <div className="flex h-full flex-col p-4 sm:p-5">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-base font-medium text-cream sm:text-lg">AI Inbox</h3>
            <Pill tone="terra">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terra-bright" /> 24/7 · EN / සිං / தமிழ்
            </Pill>
          </div>
          <p className="mt-1 text-[12.5px] text-sand">
            You&apos;re the customer. <span className="text-cream-2">Send a message and watch the system qualify, book and hand off.</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 font-mono text-[11px] text-sand tabular-nums">
            {list.filter((c) => c.unread).length} unread · avg first reply 31s
          </span>
          <GhostButton onClick={reset}>Reset conversation</GhostButton>
        </div>
      </div>

      <div className="grid grid-cols-1 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_224px] xl:grid-cols-[196px_minmax(0,1fr)_228px]">
        {/* Conversation chips (< xl) */}
        <div className="scroll-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:col-span-2 xl:hidden" data-lenis-prevent>
          {list.map((c) => (
            <ConvChip key={c.id} c={c} compact />
          ))}
        </div>

        {/* Conversation list (xl) */}
        <div className="hidden min-h-0 flex-col rounded-none border border-cream/[0.07] bg-ink/25 p-2 xl:flex">
          <div className="flex items-center justify-between px-1.5 pb-2 pt-1">
            <span className="text-[12px] font-medium uppercase tracking-[0.12em] text-cream-2">Conversations</span>
            <span className="font-mono text-[10.5px] text-sand tabular-nums">{list.length} open</span>
          </div>
          <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto" data-lenis-prevent>
            {list.map((c) => (
              <ConvChip key={c.id} c={c} />
            ))}
          </div>
          <div className="mt-2 rounded-none border border-dashed border-cream/[0.08] px-3 py-2 text-center text-[10.5px] text-sand/70">
            +11 handled today
          </div>
        </div>

        {/* Chat thread */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-none border border-cream/[0.07] bg-ink/25">
          <div className="flex items-center justify-between gap-3 border-b border-cream/[0.07] px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar name={conv.name} size={28} />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium leading-tight text-cream">{conv.name}</p>
                <p className="truncate text-[10.5px] text-sand">WhatsApp · {conv.business} · {langLabel.label}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden items-center gap-1.5 font-mono text-[10px] text-sand sm:inline-flex">
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-300" /> AI rep active
              </span>
              <ScoreBadge score={conv.score} />
            </div>
          </div>

          <div
            ref={threadRef}
            data-lenis-prevent
            className="scroll-thin max-h-[380px] min-h-[320px] flex-1 space-y-3 overflow-y-auto px-3 py-3 lg:max-h-[440px] lg:min-h-[360px]"
            aria-live="polite"
          >
            {conv.msgs.map((m) => {
              if (m.from === "system") {
                return (
                  <div key={m.id} className="rise-in flex items-center gap-2 py-1">
                    <span className="h-px flex-1 bg-cream/[0.08]" />
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-emerald-200 ring-1 ring-emerald-300/20">
                      <Icon.check size={11} /> {m.text}
                    </span>
                    <span className="h-px flex-1 bg-cream/[0.08]" />
                  </div>
                );
              }
              const ai = m.from === "ai";
              return (
                <div key={m.id} className={`rise-in flex flex-col ${ai ? "items-end" : "items-start"}`}>
                  <div
                    className={`max-w-[88%] rounded-none px-3 py-2 text-[12.5px] leading-relaxed sm:max-w-[80%] ${
                      ai
                        ? "bg-terra/[0.14] text-cream ring-1 ring-terra/20"
                        : "bg-cream/[0.06] text-cream ring-1 ring-cream/10"
                    }`}
                  >
                    {ai && (
                      <span className="mb-1 flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-terra-bright">
                        <Icon.spark size={10} /> AI rep
                      </span>
                    )}
                    <span className="whitespace-pre-wrap">
                      {ai ? (
                        <Typewriter
                          text={m.text}
                          animate={!!m.animate}
                          onDone={() => markTyped(conv.id, m.id)}
                          onGrow={scrollToEnd}
                        />
                      ) : (
                        m.text
                      )}
                    </span>

                    {m.card === "check" && <SiteCheckCard conv={conv} />}

                    {m.slots && !m.animate && (
                      <div className="rise-in mt-2.5 flex flex-wrap gap-2">
                        {conv.slots.map((s) => {
                          const chosen = conv.booked === s;
                          const locked = conv.booked != null;
                          return (
                            <button
                              key={s}
                              type="button"
                              disabled={locked || conv.busy}
                              onClick={() => void send(`${s} works for me.`, s)}
                              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px] tabular-nums transition-all ${
                                chosen
                                  ? "border-terra/60 bg-terra/25 text-cream"
                                  : locked
                                    ? "border-cream/10 text-sand/50"
                                    : "border-terra/40 bg-ink/40 text-terra-bright hover:border-terra hover:bg-terra/15 disabled:opacity-60"
                              }`}
                            >
                              {chosen ? <Icon.check size={12} /> : <Icon.calendar size={12} />}
                              {s}
                            </button>
                          );
                        })}
                        {!locked(conv) && <span className="self-center text-[10.5px] text-sand">Tap a slot to book</span>}
                      </div>
                    )}
                  </div>
                  <span className="mt-1 font-mono text-[10px] text-sand tabular-nums">
                    {base == null ? "" : fmtTime(base + m.at)}
                    {ai && " · sent by AI"}
                  </span>
                </div>
              );
            })}
            {conv.busy && <TypingDots />}
          </div>

          {/* Composer */}
          <div className="border-t border-cream/[0.07] px-3 pb-3 pt-2.5">
            <div className="scroll-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2" data-lenis-prevent>
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={conv.busy}
                  onClick={() => void send(q)}
                  className="shrink-0 rounded-full border border-cream/12 bg-cream/[0.03] px-2.5 py-1 text-[11px] text-cream-2 transition-all hover:border-terra/40 hover:text-cream disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
            <form onSubmit={onSubmit} className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={conv.busy}
                placeholder={scripted ? "Anything else before the call?" : `Type as ${firstName(conv.name)}…`}
                aria-label="Message as the customer"
                className="min-w-0 flex-1 rounded-none border border-cream/10 bg-ink/50 px-3.5 py-2 text-[12.5px] text-cream placeholder:text-sand/70 outline-none transition-colors focus:border-terra/50 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={conv.busy || !draft.trim()}
                aria-label="Send"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-none bg-gradient-to-b from-terra-bright to-terra text-cream shadow-[0_8px_20px_-8px_rgba(198,93,59,0.9)] transition-all hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
              >
                <Icon.send size={15} />
              </button>
            </form>
            <p className="mt-1.5 text-[10.5px] text-sand/80">Enter sends. Any message advances the conversation — the AI rep qualifies, audits, books, then hands off.</p>
          </div>
        </div>

        {/* Lead profile rail */}
        <aside className="relative overflow-hidden rounded-none border border-cream/[0.07] bg-ink/25 p-3.5">
          <div className="glow-terra pointer-events-none absolute -right-12 -top-12 h-32 w-32 opacity-30" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-[0.16em] text-sand">Lead profile</p>
              <span className="font-mono text-[9.5px] text-terra-bright">auto-filled</span>
            </div>
            <div className="mt-2.5 flex items-center gap-2.5">
              <Avatar name={conv.name} size={34} />
              <div className="min-w-0">
                <p className="truncate font-display text-[15px] text-cream">{conv.name}</p>
                <p className="truncate text-[11px] text-sand">{conv.business === "" ? "—" : conv.stage === "open" ? "Business · detecting" : conv.business}</p>
              </div>
            </div>

            <ScoreMeter score={conv.score} />

            <ul className="mt-3">
              <Field label="Name" value={conv.name} />
              <Field label="Business" value={conv.stage === "open" ? null : conv.business} />
              <Field label="Intent" value={conv.intent} />
              <Field label="Language" value={langLabel.label} />
              <Field label="Booked" value={conv.booked ? `${conv.booked} · reminder set` : null} />
            </ul>

            <div className="mt-3 min-h-[38px]">
              {conv.handoff ? (
                <div className="rise-in flex items-center gap-2 rounded-none border border-terra/30 bg-terra/10 px-3 py-2 text-[12px] text-cream">
                  <Icon.user size={13} className="text-terra-bright" />
                  Handoff to: <span className="font-medium">{conv.handoff}</span>
                  <span className="ml-auto font-mono text-[9.5px] text-terra-bright">context attached</span>
                </div>
              ) : (
                <div className="rounded-none border border-dashed border-cream/[0.08] px-3 py-2 text-[10.5px] text-sand/60">
                  Handoff appears once a slot is booked
                </div>
              )}
            </div>

            <p className="mt-4 text-[10px] uppercase tracking-[0.16em] text-sand">Timeline</p>
            <ol className="mt-2 space-y-0">
              {TIMELINE.map((s, i) => {
                const state = i < doneSteps ? "done" : i === doneSteps ? "active" : "todo";
                const lastStep = i === TIMELINE.length - 1;
                return (
                  <li key={s.t} className="relative flex items-start gap-2.5 pb-3 last:pb-0">
                    {!lastStep && (
                      <span
                        className={`absolute left-[9px] top-5 h-[calc(100%-14px)] w-px transition-colors duration-500 ${
                          state === "done" ? "bg-terra/50" : "bg-cream/10"
                        }`}
                      />
                    )}
                    <span
                      className={`relative z-[1] mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full text-[9px] ring-1 transition-all duration-500 ${
                        state === "done"
                          ? "bg-terra text-cream ring-terra"
                          : state === "active"
                            ? "bg-terra/20 text-terra-bright ring-terra/60"
                            : "bg-ink/40 text-sand ring-cream/15"
                      }`}
                    >
                      {state === "done" ? <Icon.check size={10} /> : state === "active" ? <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terra-bright" /> : i + 1}
                    </span>
                    <span className={`min-w-0 flex-1 transition-opacity duration-500 ${state === "todo" ? "opacity-45" : "opacity-100"}`}>
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-[11.5px] leading-tight text-cream">{s.t}</span>
                        <span className="shrink-0 font-mono text-[9.5px] text-sand tabular-nums">{s.tag}</span>
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}

const locked = (c: Conv) => c.booked != null;
