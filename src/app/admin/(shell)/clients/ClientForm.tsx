"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import Modal from "@/components/admin/Modal";
import { Icon } from "@/components/admin/icons";
import { useAction } from "@/components/admin/useAction";
import { Button, Checkbox, Field, Input, Select, Textarea } from "@/components/admin/ui";
import { displayName } from "@/lib/admin/format";
import type { TeamMember } from "@/lib/admin/types";
import { addClient, deleteClient, setClientStatus, updateClient } from "@/app/admin/actions/clients";
import { CLIENT_STATUS, CLIENT_STATUSES, clientTitle, type Client } from "./model";

/**
 * Add or edit a client. Used by the list (add) and the profile (edit, archive,
 * delete). A new client opens on its profile once saved.
 */
export default function ClientForm({
  open,
  onClose,
  client,
  managers,
  me,
  ownership,
  managerName,
}: {
  open: boolean;
  onClose: () => void;
  client?: Client;
  /** Teammates who can open Clients — the only valid account managers. */
  managers: TeamMember[];
  me: string;
  /** The account-manager column (0012) is in place. */
  ownership: boolean;
  /** Current manager's name, for one who has since lost Clients access. */
  managerName?: string;
}) {
  const router = useRouter();
  const { run, pending, toast } = useAction();
  const managerKnown = !client?.account_manager_id || managers.some((m) => m.id === client.account_manager_id);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(client ? () => updateClient(client.id, fd) : () => addClient(fd), {
      onDone: (r) => {
        if (!r.ok) return;
        onClose();
        if (!client && r.id) router.push(`/admin/clients/${r.id}`);
      },
    });
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={client ? `Edit ${clientTitle(client)}` : "Add a client"}
        hint={client ? "Changes show everywhere this client is picked." : "Only the contact name is required."}
        width="max-w-2xl"
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Contact name">
              <Input name="name" required defaultValue={client?.name ?? ""} placeholder="Nadia Perera" />
            </Field>
            <Field label="Business">
              <Input name="company" defaultValue={client?.company ?? ""} placeholder="Perera Dental" />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" defaultValue={client?.email ?? ""} placeholder="accounts@example.lk" />
            </Field>
            <Field label="Phone / WhatsApp">
              <Input name="phone" defaultValue={client?.phone ?? ""} placeholder="+94 7…" />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Input name="address" defaultValue={client?.address ?? ""} placeholder="No. 12, Flower Road" />
            </Field>
            <Field label="City">
              <Input name="city" defaultValue={client?.city ?? ""} placeholder="Colombo 07" />
            </Field>
            <Field label="Country">
              <Input name="country" defaultValue={client ? (client.country ?? "") : "Sri Lanka"} />
            </Field>
            <Field label="Tax / VAT number" hint="Printed on invoices when set.">
              <Input name="tax_id" defaultValue={client?.tax_id ?? ""} />
            </Field>
            <Field label="Website">
              <Input name="website" defaultValue={client?.website ?? ""} placeholder="pereradental.lk" />
            </Field>
            {client?.statement_monthly !== undefined && (
              <div className="space-y-2.5 sm:col-span-2">
                <input type="hidden" name="billing_prefs" value="1" />
                <Checkbox
                  name="statement_monthly"
                  defaultChecked={!!client.statement_monthly}
                  label="Email a statement every month"
                  hint="On the 1st, for the month before — while they owe something. Goes to the email above."
                />
                <Checkbox
                  name="reminders_paused"
                  defaultChecked={!!client.reminders_paused}
                  label="No payment reminders"
                  hint="Overdue invoices to this client don't get the automatic reminder emails."
                />
              </div>
            )}
            <Field label="Status">
              <Select name="status" defaultValue={client?.status ?? "active"}>
                {CLIENT_STATUSES.map((s) => (
                  <option key={s} value={s} className="bg-ink text-cream">
                    {CLIENT_STATUS[s].label}
                  </option>
                ))}
              </Select>
            </Field>
            {ownership && (
              <Field
                label="Account manager"
                hint={managerKnown ? undefined : "Their Clients access was removed — pick someone new."}
              >
                {/* A blank value leaves the manager as is; new clients default to you. */}
                <Select
                  name="account_manager_id"
                  defaultValue={client ? (managerKnown ? client.account_manager_id ?? "" : "") : me}
                >
                  {client && !client.account_manager_id && (
                    <option value="" className="bg-ink text-cream">
                      Unassigned
                    </option>
                  )}
                  {!managerKnown && (
                    <option value="" className="bg-ink text-cream">
                      {managerName ?? "Former teammate"}
                    </option>
                  )}
                  {managers.map((m) => (
                    <option key={m.id} value={m.id} className="bg-ink text-cream">
                      {displayName(m)}
                      {m.id === me ? " (you)" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          {/* On the profile, notes have their own panel — the edit form leaves them alone. */}
          {!client && (
            <Field label="Notes">
              <Textarea name="notes" rows={3} placeholder="How they found us, who signs off, anything the team should know…" />
            </Field>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
            {client && (
              <div className="mr-auto flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={pending}
                  className="pointer-coarse:min-h-9"
                  onClick={() =>
                    run(() => setClientStatus(client.id, client.status === "archived" ? "active" : "archived"), {
                      onDone: (r) => r.ok && onClose(),
                    })
                  }
                >
                  <Icon.archive size={13} /> {client.status === "archived" ? "Restore" : "Archive"}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={pending}
                  className="pointer-coarse:min-h-9"
                  onClick={() => {
                    if (!confirm(`Delete ${clientTitle(client)}? Linked leads and events stay, unlinked. This cannot be undone.`))
                      return;
                    run(() => deleteClient(client.id), {
                      onDone: (r) => {
                        if (!r.ok) return;
                        onClose();
                        router.push("/admin/clients");
                      },
                    });
                  }}
                >
                  <Icon.trash size={13} /> Delete
                </Button>
              </div>
            )}
            <Button type="button" onClick={onClose} className="pointer-coarse:min-h-9">
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {client ? "Save client" : "Add client"}
            </Button>
          </div>
        </form>
      </Modal>
      {toast}
    </>
  );
}
