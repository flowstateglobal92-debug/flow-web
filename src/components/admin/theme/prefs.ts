import { useSyncExternalStore } from "react";
import { THEME_KEY } from "@/lib/theme";

/**
 * The admin's appearance, per device: Cream, Dark or Follow system, kept in
 * this browser's storage and read through useSyncExternalStore (the server
 * render and the first client render agree on the default, then the stored
 * choice takes over).
 *
 * The desktop app swaps this module for
 * desktop/src/renderer/replacements/theme-prefs.ts — same exports — where the
 * app keeps the choice (it needs it before a window opens) and adds text size
 * and density.
 */

export type ThemePref = "cream" | "dark" | "system";
export type Theme = "cream" | "dark";
export type TextSize = "default" | "larger" | "largest";

/** The website keeps its dark look unless someone picks otherwise. */
export const DEFAULT_THEME: ThemePref = "dark";
/** The Appearance panel's subtitle: where the choice is kept. */
export const APPEARANCE_HINT = "How the admin looks in this browser. Your other devices keep their own.";
/** A browser tab can't set its own zoom (the browser's zoom does that); the desktop app can. */
export const CAN_SET_TEXT_SIZE = false;
export const TEXT_SIZE_HINT = "";

/** The page colour of each theme (`--color-ink`), for the browser's own chrome. */
const PAGE: Record<Theme, string> = { dark: "#0b0806", cream: "#e8ddcc" };

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

// Private windows can refuse storage; remember the choice for this tab anyway.
let memory: string | null = null;

const isPref = (v: unknown): v is ThemePref => v === "cream" || v === "dark" || v === "system";

export function readThemePref(): ThemePref {
  if (typeof window === "undefined") return DEFAULT_THEME;
  let raw = memory;
  try {
    raw = window.localStorage.getItem(THEME_KEY) ?? memory;
  } catch {
    // storage blocked — `memory` carries it
  }
  return isPref(raw) ? raw : DEFAULT_THEME;
}

export function writeThemePref(next: ThemePref) {
  memory = next;
  try {
    window.localStorage.setItem(THEME_KEY, next);
  } catch {
    // storage blocked — `memory` carries it
  }
  emit();
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)");

export function resolveTheme(pref: ThemePref): Theme {
  if (pref !== "system") return pref;
  return typeof window !== "undefined" && systemDark().matches ? "dark" : "cream";
}

function setThemeColor(color: string) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
}

/** Put a theme on the page. Dark is the stylesheet's default, so it's the absence of the attribute. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "cream") root.setAttribute("data-theme", "cream");
  else root.removeAttribute("data-theme");
  setThemeColor(PAGE[theme]);
}

/** Leaving the admin for the website (client-side navigation): back to the site's own look. */
export function releaseTheme() {
  document.documentElement.removeAttribute("data-theme");
  setThemeColor(PAGE.dark);
}

/** Changes to the choice (here or in another tab) and to the system's light/dark setting. */
export function subscribeTheme(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY) onChange();
  };
  const query = systemDark();
  window.addEventListener("storage", onStorage);
  query.addEventListener("change", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
    query.removeEventListener("change", onChange);
  };
}

export const useThemePref = () => useSyncExternalStore(subscribeTheme, readThemePref, () => DEFAULT_THEME);

/* Text size and density are the desktop app's (see CAN_SET_TEXT_SIZE); these keep the exports aligned. */
export const readTextSize = (): TextSize => "default";
export const writeTextSize: (size: TextSize) => void = () => {};
export const useTextSize = (): TextSize => "default";

export type Density = "comfortable" | "compact";
/** The website keeps one layout; the desktop app adds a compact one for long lists. */
export const CAN_SET_DENSITY = false;
export const readDensity = (): Density => "comfortable";
export const writeDensity: (density: Density) => void = () => {};
export const useDensity = (): Density => "comfortable";
