/**
 * The path the browser actually loaded this document on.
 *
 * Captured at module-evaluation time, which happens once per document load —
 * client-side navigations don't re-run it. Imported by `SmoothScroll` (root
 * layout, so it evaluates on every route) as well as by the preloader, so the
 * value is always the real entry URL rather than wherever the user has since
 * navigated to.
 */
const entryPath = typeof window === "undefined" ? null : window.location.pathname;

/** True when the document was loaded on `path` (not navigated to it client-side). */
export function isEntryPath(path: string): boolean {
  return entryPath === path;
}
