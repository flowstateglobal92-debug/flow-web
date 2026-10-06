import { useSyncExternalStore } from "react";

/**
 * How this browser announces a new notification: an optional soft chime and,
 * while the tab is in the background, an OS notification. Both are per device
 * (a phone and a laptop want different things), so they live in localStorage
 * and are read through useSyncExternalStore — the server render and the first
 * client render agree on the defaults, then the stored choice takes over.
 */

export type AlertPrefs = { sound: boolean; desktop: boolean };

const KEY = "flowstate:alert-prefs";
const DEFAULTS: AlertPrefs = { sound: false, desktop: false };

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

// Private windows can refuse storage; remember the choice for this tab anyway.
let memory: string | null = null;
let cachedRaw: string | null | undefined;
let cached: AlertPrefs = DEFAULTS;

function readRaw() {
  try {
    return window.localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

/** Current prefs. Returns the same object until they change (a snapshot must be stable). */
export function readAlertPrefs(): AlertPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const v = raw ? (JSON.parse(raw) as Partial<AlertPrefs>) : {};
      cached = { sound: v.sound === true, desktop: v.desktop === true };
    } catch {
      cached = DEFAULTS;
    }
  }
  return cached;
}

export function writeAlertPrefs(next: Partial<AlertPrefs>) {
  const value = JSON.stringify({ ...readAlertPrefs(), ...next });
  memory = value;
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    // Storage blocked — `memory` carries it.
  }
  emit();
}

function subscribePrefs(onChange: () => void) {
  listeners.add(onChange);
  // Another tab changed them.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export const useAlertPrefs = () => useSyncExternalStore(subscribePrefs, readAlertPrefs, () => DEFAULTS);

/* ───────────────────────── desktop permission ───────────────────────── */

export type DesktopPermission = NotificationPermission | "unsupported";

const readPermission = (): DesktopPermission =>
  typeof Notification === "undefined" ? "unsupported" : Notification.permission;

function subscribePermission(onChange: () => void) {
  listeners.add(onChange);
  // Changing it in the browser's site settings fires here where supported.
  let status: PermissionStatus | null = null;
  let gone = false;
  navigator.permissions
    ?.query({ name: "notifications" as PermissionName })
    .then((s) => {
      if (gone) return;
      status = s;
      s.addEventListener("change", onChange);
    })
    .catch(() => {});
  return () => {
    gone = true;
    listeners.delete(onChange);
    status?.removeEventListener("change", onChange);
  };
}

export const useDesktopPermission = () =>
  useSyncExternalStore(subscribePermission, readPermission, (): DesktopPermission => "default");

export async function requestDesktopPermission(): Promise<DesktopPermission> {
  if (typeof Notification === "undefined") return "unsupported";
  const result = await Notification.requestPermission();
  emit();
  return result;
}

/* ───────────────────────────── outputs ──────────────────────────────── */

let audio: AudioContext | null = null;

/** Two soft sine notes, synthesised — no asset to fetch. Silent if the browser blocks audio. */
export function playChime() {
  try {
    const AC =
      window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    audio ??= new AC();
    if (audio.state === "suspended") void audio.resume();
    const t = audio.currentTime + 0.02;
    [880, 1318.5].forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      const start = t + i * 0.13;
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.05, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.7);
      osc.connect(gain).connect(audio!.destination);
      osc.start(start);
      osc.stop(start + 0.75);
    });
  } catch {
    // Autoplay policy or no audio device — the visual alert still shows.
  }
}

/** An OS notification, only when this tab is hidden and permission was granted. */
export function showDesktopAlert(
  n: { id: string; title: string; body: string | null; link: string | null },
  open: (link: string) => void,
) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (document.visibilityState !== "hidden") return;
  try {
    const note = new Notification(n.title, { body: n.body ?? undefined, tag: n.id, icon: "/brand/mark-256.webp" });
    note.onclick = () => {
      window.focus();
      if (n.link) open(n.link);
      note.close();
    };
  } catch {
    // Android Chrome only allows notifications from a service worker.
  }
}
