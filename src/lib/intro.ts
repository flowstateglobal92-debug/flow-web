/**
 * Boot-time wiring for the brand intro.
 *
 * The preloader is a React component, so its markup only becomes visible once
 * hydration runs — which is long after the browser has painted the home page.
 * `INTRO_BOOT_SCRIPT` runs inline in the document head, before the first paint,
 * and marks the document so CSS can show the veil from frame one. It applies the
 * same two conditions the component uses (a real load of the home page, and no
 * reduced-motion preference), so the veil never appears for a visit that skips
 * the intro. The intro plays on every load of "/" — a refresh replays it.
 */

/** Set by the component while it owns the veil — the boot script's failsafe checks it. */
export const INTRO_LIVE_ATTR = "data-intro-live";

/** How long the boot script waits for hydration before releasing the veil. */
const HYDRATION_FAILSAFE_MS = 6000;

export const INTRO_BOOT_SCRIPT = `(function(){try{
var d=document.documentElement;
if(location.pathname!=="/")return;
if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;
d.classList.add("is-preloading");
setTimeout(function(){if(!d.hasAttribute(${JSON.stringify(INTRO_LIVE_ATTR)}))d.classList.remove("is-preloading");},${HYDRATION_FAILSAFE_MS});
}catch(e){}})();`;
