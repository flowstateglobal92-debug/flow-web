"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Modal from "../Modal";
import { Icon } from "../icons";
import type { useAction } from "../useAction";
import { Avatar, Badge, Button, Notice } from "../ui";
import { formatDate } from "@/lib/admin/format";
import { cancelTimeOff, deleteTimeOff, getTimeOff } from "@/app/admin/actions/timeoff";
import { dayRangeLabel } from "../calendar/items";
import { HALF_DAY_LABEL, STATUS_TONE, TIME_OFF_LABEL, type TimeOffDetailData } from "./timeoff";

type Run = ReturnType<typeof useAction>["run"];

/**
 * One leave entry — opened from the calendar's "Who's out" row or from
 * /admin/calendar?timeoff=<id>. Read-only apart from cancel/remove, which
 * follow the 0019 rules (members: own pending; admins: anything).
 */
export default function TimeOffDetail({
  id,
  onClose,
  run,
  pending,
}: {
  id: string | null;
  onClose: () => void;
  run: Run;
  pending: boolean;
}) {
  const [loaded, setLoaded] = useState<{ id: string; detail: TimeOffDetailData } | null>(null);
  // Reopening shows a fresh copy (or "Loading…"), never the last one's.
  if (!id && loaded) setLoaded(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    getTimeOff(id)
      .then((detail) => {
        if (live) setLoaded({ id, detail });
      })
      .catch(() => {
        // Offline, or a deploy swapped the action out from under the page.
        if (live) {
          setLoaded({
            id,
            detail: {
              ok: false,
              error: "Couldn't load this leave entry — try again.",
              row: null,
              person: null,
              decider: null,
              canCancel: false,
              canDelete: false,
              isApprover: false,
            },
          });
        }
      });
    return () => {
      live = false;
    };
  }, [id]);

  const detail = loaded && loaded.id === id ? loaded.detail : null;
  const row = detail?.row ?? null;

  return (
    <Modal
      open={!!id}
      onClose={onClose}
      title={row ? TIME_OFF_LABEL[row.type] ?? "Time off" : "Time off"}
      hint={row ? dayRangeLabel(row.starts_on, row.ends_on) : undefined}
      footer={
        row && detail ? (
          <>
            {detail.canDelete && (
              <Button
                type="button"
                variant="danger"
                className="mr-auto"
                disabled={pending}
                onClick={() => {
                  if (confirm("Remove this leave entry?")) run(() => deleteTimeOff(row.id), { onDone: (r) => r.ok && onClose() });
                }}
              >
                <Icon.trash size={13} /> Remove
              </Button>
            )}
            {detail.isApprover && row.status === "pending" && (
              <Link
                href="/admin/approvals"
                className="inline-flex items-center gap-1.5 border border-cream/12 bg-cream/[0.03] px-3 py-1.5 text-[12px] font-medium text-cream-2 transition-colors hover:border-cream/30 hover:text-cream"
              >
                <Icon.shield size={13} /> Review in Approvals
              </Link>
            )}
            {detail.canCancel && (
              <Button
                type="button"
                disabled={pending}
                onClick={() => run(() => cancelTimeOff(row.id), { onDone: (r) => r.ok && onClose() })}
              >
                {row.status === "pending" ? "Cancel request" : "Cancel leave"}
              </Button>
            )}
            <Button type="button" onClick={onClose}>
              Close
            </Button>
          </>
        ) : undefined
      }
    >
      {!detail ? (
        <p className="py-4 text-center font-mono text-[11px] text-sand">Loading…</p>
      ) : !detail.ok || !row ? (
        <Notice tone="danger" title="Couldn't open this leave entry">
          {detail.error}
        </Notice>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar name={detail.person ?? "?"} size={34} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] text-cream">{detail.person}</p>
              <p className="font-mono text-[10.5px] text-sand">
                {dayRangeLabel(row.starts_on, row.ends_on)}
                {row.half_day ? ` · ${HALF_DAY_LABEL[row.half_day]} only` : ""}
              </p>
            </div>
            <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>
          </div>

          {row.note && <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-cream-2">{row.note}</p>}

          {row.decided_at && (row.status === "approved" || row.status === "rejected") && (
            <p className="text-[11.5px] text-sand">
              {row.status === "approved" ? "Approved" : "Rejected"}
              {detail.decider ? ` by ${detail.decider}` : ""} on {formatDate(row.decided_at)}
            </p>
          )}
          {row.status === "pending" && (
            <p className="text-[11.5px] text-sand">Waiting for an admin. It shows dashed on the calendar until then.</p>
          )}
        </div>
      )}
    </Modal>
  );
}
