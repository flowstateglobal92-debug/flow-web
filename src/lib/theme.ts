/**
 * Boot-time wiring for the admin's theme (My account › Appearance).
 *
 * The choice lives in this browser's storage, so the server can't render it.
 * `THEME_BOOT_SCRIPT` runs inline in the document head, before the first
 * paint, and puts `data-theme="cream"` on <html> when that's the choice for
 * an admin page — so a cream admin never flashes dark while it loads. The
 * website itself is always dark: other paths are left alone, and
 * ThemeController takes the attribute off again when someone leaves the admin.
 *
 * The desktop app doesn't use this: its window gets the attribute from the
 * app (desktop/src/main/appearance.ts) before anything paints.
 */

/** localStorage key for the choice: "cream", "dark" or "system". */
export const THEME_KEY = "flowstate:theme";

export const THEME_BOOT_SCRIPT = `(function(){try{
if(!/^\\/admin(\\/|$)/.test(location.pathname))return;
var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});
if(t==="system")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"cream";
if(t==="cream")document.documentElement.setAttribute("data-theme","cream");
}catch(e){}})();`;
