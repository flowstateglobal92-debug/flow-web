"use client";

import { useMemo, useState } from "react";
import MentionInput from "@/components/admin/comments/MentionInput";
import { Icon } from "@/components/admin/icons";
import type { useAction } from "@/components/admin/useAction";
import { Button, Input, Select } from "@/components/admin/ui";
import { personName } from "@/components/admin/calendar/items";
import { addDays, fromLocalInput, todayISO } from "@/lib/admin/format";
import type { TeamMember } from "@/lib/admin/types";
import { createTodo } from "@/app/admin/actions/todos";
import { findMentions, stripMentions } from "./model";

type Run = ReturnType<typeof useAction>["run"];
type Due = "" | "today" | "tomorrow" | "pick";

/**
 * One line to capture a to-do. "@Name" tags people (they become assignees and
 * the mention leaves the title); tagging without a date makes it due today,
 * all day, so it lands on their calendar.
 */
export default function QuickAdd({ people, run, pending }: { people: TeamMember[]; run: Run; pending: boolean }) {
  const [value, setValue] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [due, setDue] = useState<Due>("");
  const [day, setDay] = useState("");

  const named = useMemo(() => people.map((p) => ({ id: p.id, name: personName(p) })), [people]);
  // Ids from the mention picker plus any "@Name" typed by hand.
  const tagged = useMemo(() => {
    const ids = new Set([...picked, ...findMentions(value, named)]);
    return named.filter((p) => ids.has(p.id));
  }, [picked, value, named]);

  const submit = () => {
    const title = stripMentions(value, tagged.map((p) => p.name));
    // Enter submits too, so repeat the button's own guards.
    if (!title || pending || (due === "pick" && !day)) return;
    const today = todayISO();
    const dueDay = due === "today" ? today : due === "tomorrow" ? addDays(today, 1) : due === "pick" ? day : "";
    run(
      () =>
        createTodo({
          title,
          assignees: tagged.map((p) => p.id),
          due_at: dueDay ? fromLocalInput(dueDay) : null,
          all_day: true,
        }),
      {
        onDone: (r) => {
          if (!r.ok) return;
          setValue("");
          setPicked([]);
          setDue("");
          setDay("");
        },
      },
    );
  };

  return (
    <div className="mb-4 border border-cream/[0.08] bg-[linear-gradient(180deg,rgba(243,233,220,0.04),rgba(243,233,220,0.01))] p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          <MentionInput
            value={value}
            onChange={(v, ids) => {
              setValue(v);
              setPicked(ids);
            }}
            people={people}
            placeholder="Add a to-do — type @ to tag someone"
            label="New to-do"
            rows={1}
            onSubmit={submit}
            submitOnEnter
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-36">
            <Select value={due} onChange={(e) => setDue(e.target.value as Due)} aria-label="Due">
              <option value="" className="bg-ink text-cream">
                No date
              </option>
              <option value="today" className="bg-ink text-cream">
                Today
              </option>
              <option value="tomorrow" className="bg-ink text-cream">
                Tomorrow
              </option>
              <option value="pick" className="bg-ink text-cream">
                Pick a day…
              </option>
            </Select>
          </div>
          {due === "pick" && (
            <div className="w-40">
              <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Due day" />
            </div>
          )}
          <Button variant="primary" size="md" onClick={submit} disabled={pending || !value.trim() || (due === "pick" && !day)}>
            <Icon.plus size={13} /> Add
          </Button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-sand">
        {tagged.length
          ? `Tagging ${tagged.map((p) => p.name).join(", ")}${due ? "" : " — due today, so it shows on their calendar"}.`
          : "Enter adds it. Tag people with @ — it lands on their calendar, today if there's no date."}
      </p>
    </div>
  );
}
