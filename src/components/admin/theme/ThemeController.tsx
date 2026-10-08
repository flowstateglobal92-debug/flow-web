"use client";

import { useLayoutEffect } from "react";
import { applyTheme, readThemePref, releaseTheme, resolveTheme, subscribeTheme } from "./prefs";

/**
 * Keeps <html data-theme> in step with the Appearance setting while an admin
 * page is open: on arrival (a full load was already themed by the boot script
 * in the head), when the choice changes here or in another tab, and when the
 * system flips between light and dark under "Follow system". Leaving the
 * admin hands the page back to the website's own look. A layout effect, so a
 * client-side arrival is themed before it paints.
 */
export default function ThemeController() {
  useLayoutEffect(() => {
    const sync = () => applyTheme(resolveTheme(readThemePref()));
    sync();
    const stop = subscribeTheme(sync);
    return () => {
      stop();
      releaseTheme();
    };
  }, []);
  return null;
}
