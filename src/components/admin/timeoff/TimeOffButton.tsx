"use client";

import { useCallback, useState } from "react";
import Modal from "../Modal";
import { Icon } from "../icons";
import { useAction } from "../useAction";
import { Button } from "../ui";
import TimeOffForm from "./TimeOffForm";

/** "+ Time off" on the calendar page header. `people` only for admins, who can add it for anyone. */
export default function TimeOffButton({
  me,
  people,
}: {
  me: string;
  people?: { id: string; full_name: string | null; email: string }[];
}) {
  const { run, pending, toast } = useAction();
  const [open, setOpen] = useState(false);
  // Stable, so the dialog doesn't re-grab focus every time `pending` flips.
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Icon.plane size={13} /> Time off
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="Time off"
        hint={people ? "Add leave for yourself or a teammate — it shows on the shared calendar." : "It shows on the shared calendar. An admin may need to approve it."}
      >
        {open && <TimeOffForm me={me} people={people} run={run} pending={pending} onDone={close} onCancel={close} />}
      </Modal>
      {toast}
    </>
  );
}
