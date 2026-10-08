"use client";

/**
 * A line at the foot of the side menu, between the pages and the account.
 * The website has nothing to put there; the desktop app replaces this module
 * with its sync status (desktop/src/renderer/chrome/SyncStatus.tsx), so it
 * takes its own room in the menu instead of covering the last pages.
 *
 * CONTRACT: default export, no props.
 */
export default function RailStatus() {
  return null;
}
