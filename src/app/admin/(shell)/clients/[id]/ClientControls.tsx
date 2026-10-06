"use client";

import { useCallback, useState } from "react";
import { Icon } from "@/components/admin/icons";
import { useAction } from "@/components/admin/useAction";
import { Button, Textarea } from "@/components/admin/ui";
import type { TeamMember } from "@/lib/admin/types";
import { saveClientNotes } from "@/app/admin/actions/clients";
import ClientForm from "../ClientForm";
import { LinkButton } from "../kit";
import type { Client } from "../model";

/** Header actions on the profile: back to the list, and the edit form (archive/delete live inside it). */
export function ClientActions({
  client,
  managers,
  me,
  ownership,
  managerName,
}: {
  client: Client;
  managers: TeamMember[];
  me: string;
  ownership: boolean;
  managerName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const close = useCallback(() => setEditing(false), []);

  return (
    <>
      <LinkButton href="/admin/clients">
        <Icon.chevronLeft size={13} /> All clients
      </LinkButton>
      <Button variant="primary" onClick={() => setEditing(true)}>
        <Icon.edit size={13} /> Edit client
      </Button>
      <ClientForm
        open={editing}
        onClose={close}
        client={client}
        managers={managers}
        me={me}
        ownership={ownership}
        managerName={managerName}
      />
    </>
  );
}

/** Free-form notes for the whole team. Saved explicitly — no autosave surprises. */
export function ClientNotes({ id, notes }: { id: string; notes: string | null }) {
  const { run, pending, toast } = useAction();
  const [value, setValue] = useState(notes ?? "");

  // Re-seed when the saved notes change underneath (another tab, a teammate).
  const [seed, setSeed] = useState(notes);
  if (seed !== notes) {
    setSeed(notes);
    setValue(notes ?? "");
  }

  const dirty = value.trim() !== (notes ?? "").trim();

  return (
    <>
      <Textarea
        rows={6}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Client notes"
        placeholder="Preferences, history, who signs off on what — anything the next person should know."
      />
      <div className="mt-2 flex items-center justify-end gap-3">
        {dirty && <span className="text-[11px] text-sand">Unsaved changes</span>}
        <Button
          disabled={pending || !dirty}
          className="pointer-coarse:min-h-9"
          onClick={() => run(() => saveClientNotes(id, value))}
        >
          <Icon.check size={13} /> Save notes
        </Button>
      </div>
      {toast}
    </>
  );
}
