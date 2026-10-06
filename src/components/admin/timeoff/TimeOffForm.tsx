"use client";

import { useState, type FormEvent } from "react";
import type { useAction } from "../useAction";
import { Button, Field, Input, Select, Textarea } from "../ui";
import { displayName, todayISO } from "@/lib/admin/format";
import { requestTimeOff } from "@/app/admin/actions/timeoff";
import { HALF_DAY_LABEL, TIME_OFF_LABEL, TIME_OFF_TYPES, type HalfDay } from "./timeoff";

type Run = ReturnType<typeof useAction>["run"];
type Person = { id: string; full_name: string | null; email: string };

/**
 * Request (or, for admins, add) leave. Used inline on My account and in the
 * calendar's "Time off" dialog. Pass `people` only when the viewer may add
 * leave for someone else.
 */
export default function TimeOffForm({
  me,
  people,
  defaultDay,
  run,
  pending,
  onDone,
  onCancel,
}: {
  me: string;
  people?: Person[];
  defaultDay?: string;
  run: Run;
  pending: boolean;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [from, setFrom] = useState(defaultDay ?? todayISO());
  const [to, setTo] = useState(defaultDay ?? todayISO());
  const single = from === to;
  const forOthers = !!people && people.length > 1;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => requestTimeOff(fd), { onDone: (r) => r.ok && onDone?.() });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {forOthers && (
        <Field label="For">
          <Select name="user_id" defaultValue={me}>
            {people.map((p) => (
              <option key={p.id} value={p.id} className="bg-ink text-cream">
                {p.id === me ? `${displayName(p)} (you)` : displayName(p)}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Type">
          <Select name="type" defaultValue="annual">
            {TIME_OFF_TYPES.map((t) => (
              <option key={t} value={t} className="bg-ink text-cream">
                {TIME_OFF_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Half day" hint={single ? "Optional." : "Only for a single day."}>
          <Select name="half_day" defaultValue="" disabled={!single}>
            <option value="" className="bg-ink text-cream">
              Full day
            </option>
            {(Object.keys(HALF_DAY_LABEL) as HalfDay[]).map((h) => (
              <option key={h} value={h} className="bg-ink text-cream">
                {HALF_DAY_LABEL[h]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="First day">
          <Input
            type="date"
            name="starts_on"
            required
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              // Keep the range the right way round as the start moves.
              if (to < e.target.value) setTo(e.target.value);
            }}
          />
        </Field>
        <Field label="Last day">
          <Input type="date" name="ends_on" required value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      <Field label="Note" hint="Optional — cover, contact, anything the team should know.">
        <Textarea name="note" rows={2} maxLength={500} />
      </Field>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
        {onCancel && (
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={pending}>
          {forOthers ? "Add leave" : "Request leave"}
        </Button>
      </div>
    </form>
  );
}
