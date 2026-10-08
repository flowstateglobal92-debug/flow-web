"use client";

import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { useAction } from "../useAction";
import { Badge, Button, Notice, Panel, labelClass } from "../ui";
import { isApprover } from "@/lib/admin/modules";
import type { ShellProfile } from "@/lib/admin/types";
import { cancelTimeOff, deleteTimeOff, loadTimeOff } from "@/app/admin/actions/timeoff";
import { dayRangeLabel } from "../calendar/items";
import { HALF_DAY_LABEL, STATUS_TONE, TIME_OFF_LABEL, type TimeOffList } from "./timeoff";
import TimeOffForm from "./TimeOffForm";

/**
 * "My time off" on the account page: request leave, see where each request
 * stands, cancel a pending one.
 *
 * CONTRACT (keep the export and props):
 *   <TimeOffPanel profile />   loads and saves through actions/timeoff.ts itself
 */
export default function TimeOffPanel({ profile }: { profile: ShellProfile }) {
  const { run, pending, toast } = useAction();
  const [data, setData] = useState<TimeOffList | null>(null);
  // Bumped after every change — refetches the list and resets the form.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    loadTimeOff()
      .then((d) => {
        if (live) setData(d);
      })
      .catch(() => {
        // Offline, or a deploy swapped the action out from under the page.
        if (live) setData({ ok: false, error: "Couldn't load your leave — try again.", items: [], people: [] });
      });
    return () => {
      live = false;
    };
  }, [version]);

  const reload = () => setVersion((v) => v + 1);
  const admin = isApprover(profile);

  return (
    <>
      <Panel
        title="Time off"
        hint={
          admin
            ? "Add leave for yourself or the team — it shows on the shared calendar and in Workload."
            : "Request leave — it shows on the shared calendar. An admin may need to approve it."
        }
      >
        <TimeOffForm
          key={version}
          me={profile.id}
          people={admin && data?.people.length ? data.people : undefined}
          run={run}
          pending={pending}
          onDone={reload}
        />

        <div className="mt-5 border-t border-cream/[0.08] pt-4">
          <p className={labelClass}>Your leave</p>
          {!data ? (
            <p className="py-3 font-mono text-[11px] text-sand">Loading…</p>
          ) : !data.ok ? (
            <Notice tone="warn" title="Time off isn't available">
              {data.error}
            </Notice>
          ) : data.items.length === 0 ? (
            <p className="py-3 text-[12px] text-sand">Nothing booked yet.</p>
          ) : (
            <ul>
              {data.items.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-cream/[0.05] py-2.5 last:border-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-cream">{TIME_OFF_LABEL[t.type] ?? "Time off"}</span>
                    <span className="block font-mono text-[10.5px] text-sand">
                      {dayRangeLabel(t.starts_on, t.ends_on)}
                      {t.half_day ? ` · ${HALF_DAY_LABEL[t.half_day]}` : ""}
                    </span>
                  </span>
                  <Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge>
                  {(t.status === "pending" || (admin && t.status === "approved")) && (
                    <Button
                      type="button"
                      variant="quiet"
                      className="min-h-9"
                      disabled={pending}
                      onClick={() => run(() => cancelTimeOff(t.id), { onDone: reload })}
                    >
                      Cancel
                    </Button>
                  )}
                  {admin && (
                    <button
                      type="button"
                      aria-label="Remove this entry"
                      disabled={pending}
                      onClick={() => {
                        if (confirm("Remove this leave entry?")) run(() => deleteTimeOff(t.id), { onDone: reload });
                      }}
                      className="flex h-9 w-9 items-center justify-center text-sand transition-colors hover:text-bad-200"
                    >
                      <Icon.trash size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
      {toast}
    </>
  );
}
