"use client";

import { useEffect, useRef, useState } from "react";
import { OSProvider, useOS, type ModuleId } from "./OSContext";
import { Icon, MODULE_META } from "./ui";
import Pipeline from "./modules/Pipeline";
import Inbox from "./modules/Inbox";
import Automations from "./modules/Automations";
import Finance from "./modules/Finance";
import Copilot from "./modules/Copilot";

const ORDER: ModuleId[] = ["pipeline", "inbox", "automations", "finance", "copilot"];

const MODULES: Record<ModuleId, () => React.JSX.Element> = {
  pipeline: Pipeline,
  inbox: Inbox,
  automations: Automations,
  finance: Finance,
  copilot: Copilot,
};

function TitleBar() {
  const { counters } = useOS();
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () =>
      setTime(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center justify-between gap-3 border-b border-cream/10 px-3 py-2.5 sm:gap-4 sm:px-5 sm:py-3">
      <div className="flex items-center gap-3">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-terra/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-cream/25" />
          <span className="h-2.5 w-2.5 rounded-full bg-cream/12" />
        </div>
        <span className="ml-1 hidden font-mono text-[11px] uppercase tracking-[0.2em] text-sand sm:inline">
          Flow State OS <span className="text-cream/30">/</span> Command surface
        </span>
      </div>

      <div className="hidden flex-1 justify-center md:flex">
        <div className="flex w-full max-w-sm items-center gap-2 rounded-none border border-cream/10 bg-ink/50 px-3.5 py-1.5 text-[12px] text-sand">
          <Icon.search size={14} />
          <span className="flex-1">Ask the business anything…</span>
          <kbd className="rounded-md border border-cream/15 px-1.5 py-0.5 font-mono text-[10px] text-cream-2">⌘K</kbd>
        </div>
      </div>

      <div className="flex items-center gap-3 text-[11.5px] text-sand">
        <span className="hidden items-center gap-1.5 sm:inline-flex">
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-300" />
          <span className="text-cream-2">Live</span>
        </span>
        <span className="hidden font-mono tabular-nums lg:inline">{counters.actionsRun} actions run</span>
        <span className="font-mono tabular-nums">{time}</span>
      </div>
    </div>
  );
}

function Sidebar() {
  const { module, setModule, counters } = useOS();
  return (
    <aside className="scroll-x-fade flex flex-col border-b border-cream/10 lg:border-b-0 lg:border-r">
      {/* Horizontal on mobile, vertical on desktop */}
      <nav
        className="scroll-thin scroll-x flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible lg:p-3"
        aria-label="Modules"
        data-lenis-prevent
      >
        {ORDER.map((id) => {
          const m = MODULE_META[id];
          const active = module === id;
          const I = m.icon;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setModule(id)}
              aria-current={active ? "page" : undefined}
              className={`group relative flex shrink-0 items-center gap-3 rounded-none px-3 py-2.5 text-left transition-all lg:w-full ${
                active ? "bg-cream/[0.07] text-cream" : "text-cream-2 hover:bg-cream/[0.04] hover:text-cream"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 hidden h-6 w-[3px] -translate-y-1/2 bg-terra lg:block" />
              )}
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-none ring-1 transition-colors ${
                  active ? "bg-terra/20 text-terra-bright ring-terra/40" : "bg-cream/[0.04] ring-cream/10 group-hover:ring-cream/20"
                }`}
              >
                <I size={17} />
              </span>
              <span className="pr-1">
                <span className="block text-[13px] font-medium leading-tight">{m.label}</span>
                <span className="hidden text-[11px] text-sand lg:block">{m.hint}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto hidden p-4 lg:block">
        <div className="glass-inset p-3.5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-sand">Recovered this session</p>
          <p className="mt-1 font-display text-2xl text-cream tabular-nums">
            {Math.floor(counters.minutesSaved / 60)}h {counters.minutesSaved % 60}m
          </p>
          <p className="mt-1 text-[11px] text-sand">
            of admin time, across{" "}
            <span className="text-cream-2 tabular-nums">{counters.actionsRun}</span> automated actions.
          </p>
          <div className="mt-3 h-1 overflow-hidden rounded-none bg-cream/10">
            <div
              className="h-full bg-gradient-to-r from-terra to-terra-bright transition-all duration-700"
              style={{ width: `${Math.min(100, (counters.minutesSaved / 600) * 100)}%` }}
            />
          </div>
        </div>
      </div>
    </aside>
  );
}

function ActivityBar() {
  const { events } = useOS();
  const latest = events.slice(0, 4);
  return (
    <div className="flex items-center gap-4 overflow-hidden border-t border-cream/10 px-4 py-2.5 sm:px-5">
      <span className="flex shrink-0 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-sand">
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terra-bright" />
        Activity
      </span>
      <div className="relative flex-1 overflow-hidden">
        <ul className="flex gap-6 whitespace-nowrap">
          {latest.map((e) => {
            const I = MODULE_META[e.module].icon;
            return (
              <li key={e.id} className="flex items-center gap-2 text-[12px] text-cream-2 animate-[float-y_0.001s]">
                <span className="text-terra-bright">
                  <I size={13} />
                </span>
                <span className="truncate">{e.text}</span>
                {e.tag && <span className="font-mono text-[10.5px] text-sand">{e.tag}</span>}
              </li>
            );
          })}
        </ul>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-ink-2 to-transparent" />
      </div>
    </div>
  );
}

function ToastRail() {
  const { events } = useOS();
  const [visible, setVisible] = useState<number[]>([]);
  const seen = useRef<Set<number>>(new Set(events.map((e) => e.id)));

  useEffect(() => {
    const fresh = events.filter((e) => !seen.current.has(e.id));
    if (!fresh.length) return;
    fresh.forEach((e) => seen.current.add(e.id));
    setVisible((v) => [...fresh.map((e) => e.id), ...v].slice(0, 3));
    const timers = fresh.map((e) =>
      setTimeout(() => setVisible((v) => v.filter((id) => id !== e.id)), 4200),
    );
    return () => timers.forEach(clearTimeout);
  }, [events]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-14 z-20 flex flex-col items-center gap-2 px-3 lg:pl-[224px]">
      {visible.map((id) => {
        const e = events.find((x) => x.id === id);
        if (!e) return null;
        const I = MODULE_META[e.module].icon;
        return (
          <div
            key={id}
            className="os-drawer flex w-[min(340px,100%)] items-start gap-3 px-3.5 py-3 text-[12.5px] animate-[toast-in_0.5s_var(--ease-flow)]"
          >
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
                e.tone === "success"
                  ? "bg-emerald-400/15 text-emerald-200"
                  : e.tone === "warn"
                    ? "bg-amber-400/15 text-amber-200"
                    : "bg-terra/20 text-terra-bright"
              }`}
            >
              <I size={13} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block leading-snug text-cream">{e.text}</span>
              {e.tag && <span className="mt-0.5 block font-mono text-[10.5px] text-sand">{e.tag}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Shell() {
  const { module } = useOS();
  const Active = MODULES[module];
  return (
    <div className="relative">
      <div className="glass glass--strong overflow-hidden rounded-none">
        <TitleBar />
        <div className="grid grid-cols-1 lg:grid-cols-[224px_minmax(0,1fr)]">
          <Sidebar />
          <div className="relative min-w-0 min-h-[480px] bg-ink/30 sm:min-h-[560px] lg:min-h-[600px]">
            <div key={module} className="h-full min-w-0 animate-[module-in_0.55s_var(--ease-flow)]">
              <Active />
            </div>
          </div>
        </div>
        <ActivityBar />
      </div>
      <ToastRail />
    </div>
  );
}

export default function FlowOS() {
  return (
    <OSProvider>
      <Shell />
    </OSProvider>
  );
}
