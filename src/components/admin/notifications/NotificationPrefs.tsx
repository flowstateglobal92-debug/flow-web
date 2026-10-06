"use client";

import { useState } from "react";
import { Button, Checkbox, Panel } from "../ui";
import { playChime, requestDesktopPermission, useAlertPrefs, useDesktopPermission, writeAlertPrefs } from "./prefs";

/**
 * Per-browser alert preferences (sound, desktop notifications).
 *
 * CONTRACT: default export, no props. Rendered on My account.
 */
export default function NotificationPrefs() {
  const prefs = useAlertPrefs();
  const permission = useDesktopPermission();
  const [asking, setAsking] = useState(false);

  const toggleDesktop = async (on: boolean) => {
    if (!on) return writeAlertPrefs({ desktop: false });
    if (permission === "granted") return writeAlertPrefs({ desktop: true });
    setAsking(true);
    const result = await requestDesktopPermission();
    setAsking(false);
    writeAlertPrefs({ desktop: result === "granted" });
  };

  const desktopHint =
    permission === "unsupported"
      ? "This browser can't show desktop notifications."
      : permission === "denied"
        ? "Blocked in your browser's site settings — allow notifications for this site, then tick again."
        : "Only while this tab is in the background. Your browser asks once.";

  return (
    <Panel title="Alerts" hint="How this browser tells you about new notifications. Saved on this device only.">
      <div className="flex flex-col gap-4">
        <p className="text-[12px] text-sand">
          New notifications always appear in the corner for a few seconds and stay in the bell until you read them.
        </p>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <Checkbox
            checked={prefs.sound}
            onChange={(e) => writeAlertPrefs({ sound: e.target.checked })}
            label="Soft chime"
            hint="A quiet two-note tone when an alert arrives."
            className="min-w-0 flex-1"
          />
          <Button type="button" onClick={playChime} className="min-h-9 sm:min-h-0">
            Play
          </Button>
        </div>

        <Checkbox
          checked={prefs.desktop && permission === "granted"}
          disabled={asking || permission === "unsupported"}
          onChange={(e) => void toggleDesktop(e.target.checked)}
          label="Desktop notifications"
          hint={desktopHint}
        />
      </div>
    </Panel>
  );
}
