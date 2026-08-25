"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useOSLog } from "../OSContext";
import { Avatar, GhostButton, Icon, Pill, PrimaryButton, ScoreBadge } from "../ui";

/* ───────────── Data ───────────── */
const SUGGESTIONS = [
  "What are my top priorities today?",
  "Show unpaid invoices this month",
  "Create a call task for tomorrow 10:00 with Aria Studio",
  "Prepare a project invoice draft for Bluefin Logistics",
] as const;

const CONTEXT: { label: string; value: string; icon: (p: { size?: number }) => ReactNode }[] = [
  { label: "Pipeline", value: "43 leads", icon: Icon.pipeline },
  { label: "Invoices", value: "12 open", icon: Icon.finance },
  { label: "Calendar", value: "5 calls this week", icon: Icon.calendar },
  { label: "Projects", value: "7 active", icon: Icon.doc },
  { label: "Messages", value: "WhatsApp, email", icon: Icon.inbox },
];

const PRIORITIES = [
  {
    title: "Follow up Bluefin Logistics — proposal opened twice, no reply",
    meta: "You · 10:30 · Rs 12,000",
    log: { module: "automations" as const, text: "Follow-up sent · Bluefin Logistics (proposal opened 2×)", tag: "done by system" },
  },
  {
    title: "Chase invoice #1042 · Nova Clinic — due in 2 days",
    meta: "Finance bot · 14:00 · Rs 3,600",
    log: { module: "finance" as const, text: "Collection reminder sent · Nova Clinic #1042", tag: "Rs 3,600" },
  },
  {
    title: "Confirm kickoff with Kite Interiors",
    meta: "Delivery · 16:00 · signed yesterday",
    log: { module: "automations" as const, text: "Kickoff confirmation sent · Kite Interiors", tag: "calendar + WhatsApp" },
  },
];

const INVOICES = [
  { no: "#1042", client: "Nova Clinic", due: "Due in 2 days", amount: 3600, overdue: false },
  { no: "#1039", client: "Harbour Café", due: "6 days overdue", amount: 1900, overdue: true },
  { no: "#1044", client: "Solis Realty", due: "Due in 9 days", amount: 2900, overdue: false },
];

const money = (n: number) => "Rs " + n.toLocaleString("en-US");

/* ───────────── Types ───────────── */
type Card =
  | { kind: "priorities"; done: boolean[] }
  | { kind: "invoices"; sent: boolean }
  | { kind: "task" }
  | { kind: "draft"; approved: boolean }
  | { kind: "note"; text: string };

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  card?: Card;
  /** Typewriter finished — reveals the action card. */
  typed?: boolean;
};

type Intent = Card["kind"];

function detectIntent(raw: string): Intent {
  const t = raw.toLowerCase();
  if (/(draft|prepare|quote|quotation)/.test(t) && /(invoice|deposit|bill)/.test(t)) return "draft";
  if (/(unpaid|outstanding|overdue|open|due)/.test(t) && /(invoice|payment|collect)/.test(t)) return "invoices";
  if (/(priorit|today|focus|agenda|what should i)/.test(t)) return "priorities";
  if (/(task|call|remind|schedule|meeting|book)/.test(t)) return "task";
  return "note";
}

function answerFor(intent: Intent): string {
  switch (intent) {
    case "priorities":
      return "Three things move the needle today. I've ordered them by deal value and deadline risk — say the word and I'll run each one.";
    case "invoices":
      return "Three invoices are open this month, totalling Rs 8,400. Two are inside terms; Harbour Café is six days overdue.";
    case "task":
      return "Done. Call task created for tomorrow at 10:00 and linked to Aria Studio, so the full history is there when you dial.";
    case "draft":
      return "Draft ready. Deposit invoice for Bluefin Logistics — 40% of the Rs 12,000 scope. Approve it and I'll send it with payment instructions.";
    default:
      return "I've logged that as a note on your workspace and flagged it for review.";
  }
}

function initialCard(intent: Intent, text: string): Card {
  switch (intent) {
    case "priorities":
      return { kind: "priorities", done: [false, false, false] };
    case "invoices":
      return { kind: "invoices", sent: false };
    case "task":
      return { kind: "task" };
    case "draft":
      return { kind: "draft", approved: false };
    default:
      return { kind: "note", text };
  }
}

/* ───────────── Small pieces ───────────── */
function Typewriter({ text, onDone }: { text: string; onDone: () => void }) {
  const [n, setN] = useState(0);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    // Reduced motion: reveal the whole line at once instead of char by char.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Async, as the interval was — `onDone` advances the parent's script.
      const id = setTimeout(() => {
        setN(text.length);
        doneRef.current();
      }, 0);
      return () => clearTimeout(id);
    }
    // Same ~71 characters a second the 14ms interval produced, off the frame
    // clock — one render per frame rather than four.
    const CPS = 1000 / 14;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const i = Math.min(text.length, Math.round(((now - start) / 1000) * CPS));
      setN(i);
      if (i >= text.length) {
        doneRef.current();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);

  const done = n >= text.length;
  return (
    <p className="text-[12.5px] leading-relaxed text-cream-2">
      {text.slice(0, n)}
      {!done && <span className="caret ml-0.5 inline-block h-[13px] w-[1.5px] translate-y-[2px] bg-terra-bright" />}
    </p>
  );
}

function Waveform() {
  return (
    <span className="flex h-5 items-center gap-[3px]" aria-label="Listening">
      <style href="fs-copilot-wave" precedence="default">{`@keyframes fs-copilot-wave{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}`}</style>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="block h-full w-[3px] origin-center rounded-full bg-terra-bright"
          style={{ animation: `fs-copilot-wave 0.9s ease-in-out ${i * 0.11}s infinite` }}
        />
      ))}
    </span>
  );
}

function CopilotBadge({ thinking }: { thinking?: boolean }) {
  return (
    <span
      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ring-1 ${
        thinking ? "bg-cream/[0.06] text-sand ring-cream/10" : "bg-terra/20 text-terra-bright ring-terra/30"
      }`}
    >
      <Icon.copilot size={13} />
    </span>
  );
}

function CardLabel({ children }: { children: ReactNode }) {
  return <p className="text-[10px] uppercase tracking-[0.16em] text-sand">{children}</p>;
}

/* ───────────── Action cards ───────────── */
function ActionCard({
  card,
  onUpdate,
  onLog,
}: {
  card: Card;
  onUpdate: (c: Card) => void;
  onLog: ReturnType<typeof useOSLog>;
}) {
  if (card.kind === "priorities") {
    const allDone = card.done.every(Boolean);
    return (
      <div className="glass-inset p-3.5">
        <div className="flex items-center justify-between gap-2">
          <CardLabel>Today&apos;s priorities · 3</CardLabel>
          {allDone && (
            <Pill tone="success">
              <Icon.check size={11} /> All handled
            </Pill>
          )}
        </div>
        <ul className="mt-2 divide-y divide-cream/[0.06]">
          {PRIORITIES.map((p, i) => {
            const done = card.done[i];
            return (
              <li key={p.title} className="flex items-start gap-3 py-2.5 first:pt-1.5 last:pb-0.5">
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] ring-1 transition-all duration-500 ${
                    done ? "bg-terra text-cream ring-terra" : "text-sand ring-cream/15"
                  }`}
                >
                  {done ? <Icon.check size={11} /> : i + 1}
                </span>
                <span className={`min-w-0 flex-1 transition-opacity duration-500 ${done ? "opacity-55" : ""}`}>
                  <span className="block text-[12.5px] font-medium leading-snug text-cream">{p.title}</span>
                  <span className="mt-0.5 block text-[11px] text-sand">{p.meta}</span>
                </span>
                <GhostButton
                  active={done}
                  disabled={done}
                  className="shrink-0"
                  onClick={() => {
                    if (done) return;
                    onLog(p.log, 8);
                    onUpdate({ kind: "priorities", done: card.done.map((d, j) => (j === i ? true : d)) });
                  }}
                >
                  {done ? (
                    <>
                      <Icon.check size={12} /> Done
                    </>
                  ) : (
                    <>
                      <Icon.bolt size={12} /> Do it
                    </>
                  )}
                </GhostButton>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (card.kind === "invoices") {
    const total = INVOICES.reduce((a, r) => a + r.amount, 0);
    return (
      <div className="glass-inset p-3.5">
        <div className="flex items-center justify-between gap-2">
          <CardLabel>Unpaid invoices · this month</CardLabel>
          <Pill tone={card.sent ? "success" : "warn"}>
            {card.sent ? (
              <>
                <Icon.check size={11} /> Reminders sent
              </>
            ) : (
              "1 overdue"
            )}
          </Pill>
        </div>
        <ul className="mt-2 divide-y divide-cream/[0.06]">
          {INVOICES.map((r) => (
            <li key={r.no} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 py-2 text-[12px]">
              <span className="font-mono text-[11px] text-sand">{r.no}</span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-cream">{r.client}</span>
                <span className={`block text-[11px] ${r.overdue && !card.sent ? "text-amber-200" : "text-sand"}`}>
                  {card.sent ? (r.overdue ? "Escalation sent · owner alerted" : "Reminder scheduled · before due") : r.due}
                </span>
              </span>
              <span className="font-mono text-[12px] text-cream-2 tabular-nums">{money(r.amount)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-cream/[0.08] pt-2.5">
          <span className="text-[11px] text-sand">
            Total outstanding{" "}
            <span className="ml-1 font-display text-[15px] text-cream tabular-nums">{money(total)}</span>
          </span>
          {card.sent ? (
            <span className="text-[11px] text-sand">Cadence: before due → on due → after due → escalate</span>
          ) : (
            <PrimaryButton
              onClick={() => {
                onLog({ module: "finance", text: "Payment reminder sent · Harbour Café #1039 (overdue → escalated)", tag: "Rs 1,900", tone: "warn" }, 6);
                window.setTimeout(
                  () => onLog({ module: "finance", text: "Reminders scheduled · Nova Clinic, Solis Realty (before due)", tag: "Rs 6,500" }, 6),
                  650,
                );
                onUpdate({ kind: "invoices", sent: true });
              }}
            >
              <Icon.send size={13} /> Send reminders
            </PrimaryButton>
          )}
        </div>
      </div>
    );
  }

  if (card.kind === "task") {
    return (
      <div className="glass-inset p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-none bg-cream/[0.05] text-cream-2 ring-1 ring-cream/10">
              <Icon.calendar size={16} />
            </span>
            <div>
              <p className="text-[13px] font-medium leading-tight text-cream">Call · Aria Studio</p>
              <p className="mt-0.5 text-[11px] text-sand">Tomorrow · 10:00 – 10:30</p>
            </div>
          </div>
          <Pill tone="success">
            <Icon.check size={11} /> Created
          </Pill>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-none bg-cream/[0.04] px-3 py-2">
          <div className="flex items-center gap-2.5">
            <Avatar name="Maya Fernando" size={26} />
            <div className="min-w-0">
              <p className="text-[12px] font-medium leading-tight text-cream">Maya Fernando</p>
              <p className="text-[10.5px] text-sand">Linked lead · Contacted · Rs 9,500</p>
            </div>
          </div>
          <ScoreBadge score="HOT" />
        </div>
        <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-sand">
          <Icon.bell size={12} /> Added to calendar · reminder 30 min before
        </p>
      </div>
    );
  }

  if (card.kind === "draft") {
    return (
      <div className="glass-inset relative overflow-hidden p-3.5">
        {card.approved && <div className="glow-terra pointer-events-none absolute -right-8 -top-8 h-24 w-24 opacity-40" />}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-none bg-cream/[0.05] text-cream-2 ring-1 ring-cream/10">
              <Icon.doc size={16} />
            </span>
            <div>
              <p className="text-[13px] font-medium leading-tight text-cream">Deposit invoice · #1045</p>
              <p className="mt-0.5 text-[11px] text-sand">Bluefin Logistics · Website rebuild + CRM</p>
            </div>
          </div>
          <Pill tone={card.approved ? "success" : "neutral"}>
            {card.approved ? (
              <>
                <Icon.check size={11} /> Sent
              </>
            ) : (
              "Draft"
            )}
          </Pill>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-none bg-cream/[0.04] px-3 py-2">
            <CardLabel>Deposit · 40%</CardLabel>
            <p className="font-display text-[17px] text-cream tabular-nums">Rs 4,800</p>
            <p className="text-[10.5px] text-sand">of Rs 12,000 scope</p>
          </div>
          <div className="rounded-none bg-cream/[0.04] px-3 py-2">
            <CardLabel>Terms</CardLabel>
            <p className="font-display text-[17px] text-cream tabular-nums">7 days</p>
            <p className="text-[10.5px] text-sand">then collection cadence</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] text-sand">
            <Icon.doc size={12} /> PDF with company seal · payment instructions attached
          </span>
          {card.approved ? (
            <span className="flex items-center gap-1.5 text-[11.5px] text-emerald-200">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/15 ring-1 ring-emerald-300/30">
                <Icon.check size={11} />
              </span>
              Sent to Tom Aluwihare · WhatsApp + email
            </span>
          ) : (
            <PrimaryButton
              onClick={() => {
                onLog({ module: "finance", text: "Deposit invoice #1045 sent · Bluefin Logistics", tag: "Rs 4,800", tone: "success" }, 10);
                onUpdate({ kind: "draft", approved: true });
              }}
            >
              <Icon.check size={13} /> Approve &amp; send
            </PrimaryButton>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="glass-inset p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cream/[0.05] text-cream-2 ring-1 ring-cream/10">
            <Icon.doc size={16} />
          </span>
          <div className="min-w-0">
            <CardLabel>Workspace note</CardLabel>
            <p className="mt-1 text-[12.5px] leading-snug text-cream">&ldquo;{card.text}&rdquo;</p>
          </div>
        </div>
        <Pill tone="warn">Flagged · review</Pill>
      </div>
    </div>
  );
}

/* ───────────── Module ───────────── */
export default function Copilot() {
  const log = useOSLog();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribed, setTranscribed] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  const idRef = useRef(1);
  const micIndex = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((id) => window.clearTimeout(id));
  }, []);

  // Keep the newest message in view as the stream grows (typewriter included).
  useEffect(() => {
    const el = streamRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const ro = new ResizeObserver(() => {
      el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  const updateMessage = useCallback((id: number, patch: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const run = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || thinking) return;
      const intent = detectIntent(text);
      const userId = idRef.current++;
      setMessages((prev) => [...prev, { id: userId, role: "user", text }]);
      setRecent((prev) => [text, ...prev.filter((r) => r !== text)].slice(0, 6));
      setInput("");
      setTranscribed(false);
      setThinking(true);

      // Deterministic 500–900ms "reading context" pause.
      const wait = 500 + ((text.length * 37) % 400);
      const t = window.setTimeout(() => {
        setThinking(false);
        const id = idRef.current++;
        setMessages((prev) => [...prev, { id, role: "assistant", text: answerFor(intent), card: initialCard(intent, text) }]);
        if (intent === "task") log({ module: "copilot", text: "Call task created · Aria Studio, tomorrow 10:00", tag: "calendar + reminder" }, 5);
        if (intent === "draft") log({ module: "copilot", text: "Deposit invoice draft prepared · Bluefin Logistics", tag: "awaiting approval" }, 7);
        if (intent === "note") log({ module: "copilot", text: `Note logged · "${text.length > 42 ? text.slice(0, 42) + "…" : text}"`, tag: "flagged" }, 5);
      }, wait);
      timers.current.push(t);
    },
    [log, thinking],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    run(input);
  };

  const startListening = () => {
    if (listening || thinking) return;
    setListening(true);
    setInput("");
    const t = window.setTimeout(() => {
      const next = SUGGESTIONS[micIndex.current % SUGGESTIONS.length];
      micIndex.current += 1;
      setListening(false);
      setInput(next);
      setTranscribed(true);
      inputRef.current?.focus();
    }, 1600);
    timers.current.push(t);
  };

  const clear = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    setMessages([]);
    setThinking(false);
    setListening(false);
    setTranscribed(false);
    setInput("");
  };

  const busy = thinking || listening;

  return (
    <div className="flex h-full flex-col p-4 sm:p-5">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-medium text-cream sm:text-lg">Ask the business</h3>
            <Pill tone="terra">
              <Icon.mic size={11} /> Voice + text
            </Pill>
          </div>
          <p className="mt-1 text-[12.5px] text-sand">
            It doesn&apos;t just answer — it creates, updates and prepares. <span className="text-cream-2">Try a command.</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="mr-1 font-mono text-[11px] text-sand tabular-nums">{recent.length} commands this session</span>
          <GhostButton onClick={clear} disabled={!messages.length && !input}>
            Clear
          </GhostButton>
        </div>
      </div>

      <div className="grid grid-cols-1 min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_240px]">
        {/* Main column */}
        <div className="flex min-h-0 flex-col">
          {/* Command bar */}
          <form
            onSubmit={onSubmit}
            className={`glass glass--strong flex items-center gap-2 rounded-none py-2 pl-4 pr-2 transition-colors duration-300 focus-within:border-terra/40 ${
              listening ? "border-terra/40" : ""
            }`}
          >
            <span className={`shrink-0 transition-colors ${busy ? "text-terra-bright" : "text-sand"}`}>
              {listening ? <Waveform /> : <Icon.spark size={17} />}
            </span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setTranscribed(false);
              }}
              placeholder={listening ? "Listening…" : "Ask, or tell it what to do — press Enter"}
              disabled={listening}
              aria-label="Command"
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[13.5px] text-cream placeholder:text-sand focus:outline-none disabled:opacity-60"
            />
            {transcribed && input && (
              <span className="hidden sm:inline-flex">
                <Pill tone="success">Transcribed · Enter to run</Pill>
              </span>
            )}
            <button
              type="button"
              onClick={startListening}
              disabled={busy}
              aria-label="Speak a command"
              title="Speak a command"
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 transition-all disabled:opacity-60 ${
                listening
                  ? "bg-terra/20 text-terra-bright ring-terra/50"
                  : "bg-cream/[0.04] text-cream-2 ring-cream/12 hover:bg-cream/[0.08] hover:text-cream"
              }`}
            >
              <Icon.mic size={16} />
            </button>
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send command"
              className="btn btn--primary flex h-9 w-9 shrink-0 items-center justify-center p-0 disabled:opacity-50"
            >
              <Icon.send size={15} />
            </button>
          </form>

          {/* Suggestions */}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => {
                  run(s);
                  inputRef.current?.focus();
                }}
                className="rounded-full border border-cream/10 bg-cream/[0.03] px-3 py-1.5 text-[11.5px] text-cream-2 transition-all hover:border-terra/40 hover:bg-terra/[0.08] hover:text-cream disabled:opacity-50"
              >
                &ldquo;{s}&rdquo;
              </button>
            ))}
          </div>

          {/* Stream */}
          <div
            ref={streamRef}
            data-lenis-prevent
            className="scroll-thin mt-3 max-h-[380px] min-h-[220px] flex-1 overflow-y-auto rounded-none border border-cream/[0.07] bg-ink/25"
          >
            <div ref={contentRef} className="flex flex-col gap-3 p-3.5">
              {messages.length === 0 && !thinking && (
                <div className="flex h-[200px] flex-col items-center justify-center text-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-none bg-terra/15 text-terra-bright ring-1 ring-terra/30">
                    <Icon.copilot size={18} />
                  </span>
                  <p className="mt-3 text-[12.5px] text-cream-2">Nothing asked yet.</p>
                  <p className="mt-1 max-w-xs text-[11.5px] text-sand">
                    Commands run against your live workspace — pipeline, invoices, calendar and messages — and come back as
                    actions, not just answers.
                  </p>
                </div>
              )}

              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="rise-in flex justify-end">
                    <div className="max-w-[85%] rounded-none bg-terra/15 px-3.5 py-2 text-[12.5px] leading-snug text-cream ring-1 ring-terra/25">
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="rise-in flex items-start gap-2.5">
                    <CopilotBadge />
                    <div className="min-w-0 flex-1 space-y-2.5">
                      <Typewriter text={m.text} onDone={() => updateMessage(m.id, { typed: true })} />
                      {m.typed && m.card && (
                        <div className="rise-in">
                          <ActionCard card={m.card} onUpdate={(card) => updateMessage(m.id, { card })} onLog={log} />
                        </div>
                      )}
                    </div>
                  </div>
                ),
              )}

              {thinking && (
                <div className="rise-in flex items-center gap-2.5">
                  <CopilotBadge thinking />
                  <div className="flex items-center gap-2 text-[12px] text-sand">
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cream/40" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cream/40 [animation-delay:160ms]" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cream/40 [animation-delay:320ms]" />
                    </span>
                    Reading workspace context…
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right rail */}
        <aside className="hidden min-h-0 flex-col gap-3 xl:flex">
          <div className="glass-inset p-3.5">
            <p className="text-[10px] uppercase tracking-[0.16em] text-sand">Context the copilot can see</p>
            <ul className="mt-2.5 space-y-1">
              {CONTEXT.map((c) => {
                const I = c.icon;
                return (
                  <li key={c.label} className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cream/[0.04] text-cream-2 ring-1 ring-cream/10">
                      <I size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-medium leading-tight text-cream">{c.label}</span>
                      <span className="block truncate text-[10.5px] text-sand">{c.value}</span>
                    </span>
                    <span className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" aria-label="Live" />
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="glass-inset flex min-h-0 flex-1 flex-col p-3.5">
            <p className="text-[10px] uppercase tracking-[0.16em] text-sand">Recent commands</p>
            {recent.length === 0 ? (
              <p className="mt-2 text-[11.5px] leading-snug text-sand/70">Your commands appear here as you issue them.</p>
            ) : (
              <ul className="scroll-thin mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto" data-lenis-prevent>
                {recent.map((r, i) => (
                  <li key={r} className="flex items-start gap-2 text-[11.5px] leading-snug">
                    <span className="mt-[3px] shrink-0 font-mono text-[9.5px] text-terra-bright">0{i + 1}</span>
                    <button
                      type="button"
                      onClick={() => run(r)}
                      disabled={busy}
                      className="min-w-0 truncate text-left text-cream-2 transition-colors hover:text-cream disabled:opacity-50"
                      title="Run again"
                    >
                      {r}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
