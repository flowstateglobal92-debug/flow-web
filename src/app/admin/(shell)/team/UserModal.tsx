"use client";

import { useState, type FormEvent } from "react";
import Modal from "@/components/admin/Modal";
import { Icon } from "@/components/admin/icons";
import type { useAction } from "@/components/admin/useAction";
import { Button, Checkbox, Field, Input, Notice, labelClass } from "@/components/admin/ui";
import { displayName } from "@/lib/admin/format";
import { GRANTABLE, MODULES } from "@/lib/admin/modules";
import type { ModuleKey, Workspace } from "@/lib/admin/types";
import { createTeamUser, deleteTeamUser, setTeamUserActive, updateTeamUser } from "@/app/admin/actions/team";
import type { TeamRow } from "./TeamTable";

/** Shown under the grid when a ticked module leans on one that isn't ticked. */
const DEPENDS: { key: ModuleKey; needs: ModuleKey; hint: string }[] = [
  { key: "todos", needs: "calendar", hint: "To-dos they're tagged on also show on the Calendar — without it they only see them in To-dos." },
  { key: "invoices", needs: "finance", hint: "Payments they record post to Income, but they won't see the ledger without Expenses." },
  { key: "invoices", needs: "clients", hint: "They can bill existing clients; adding a new client needs Clients." },
  { key: "crm", needs: "clients", hint: "Turning a won lead into a client needs Clients." },
  { key: "workload", needs: "todos", hint: "Workload links each person to their to-dos, which need To-dos to open." },
];

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** 12 unambiguous characters in three groups — easy to read out over the phone. */
function generatePassword() {
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

/** Copies a value and says so for a moment. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      disabled={!value}
      className="min-h-9 shrink-0"
      aria-label={`${label} to clipboard`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      {copied ? <Icon.check size={13} /> : <Icon.copy size={13} />}
      <span className="hidden sm:inline">{copied ? "Copied" : label}</span>
    </Button>
  );
}

export default function UserModal({
  member,
  workspace,
  locked,
  run,
  pending,
  onClose,
}: {
  /** null = adding someone new. */
  member: TeamRow | null;
  workspace: Workspace;
  /** Why saving is off (demo, missing key); null when changes are allowed. */
  locked: string | null;
  run: ReturnType<typeof useAction>["run"];
  pending: boolean;
  onClose: () => void;
}) {
  const superAdmin = member?.role === "super_admin";
  const [role, setRole] = useState<"admin" | "member">(member?.role === "admin" ? "admin" : "member");
  const [perms, setPerms] = useState<ModuleKey[]>(member?.permissions ?? ["dashboard"]);
  const [password, setPassword] = useState("");
  // null = the delete confirmation is closed; a string = what's been typed so far.
  const [confirmText, setConfirmText] = useState<string | null>(null);

  const toggle = (key: ModuleKey) =>
    setPerms((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      // Tagged to-dos land on the calendar, so To-dos brings Calendar along.
      const next = [...prev, key];
      if (key === "todos" && !prev.includes("calendar")) next.push("calendar");
      return next;
    });

  const gaps = role === "member" ? DEPENDS.filter((d) => perms.includes(d.key) && !perms.includes(d.needs)) : [];
  const name = member ? displayName(member) : "";
  const confirmed = !!member && confirmText?.trim().toLowerCase() === member.email.toLowerCase();

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (locked) return;
    const fd = new FormData(e.currentTarget);
    run(member ? () => updateTeamUser(member.id, fd) : () => createTeamUser(fd), {
      onDone: (r) => r.ok && onClose(),
    });
  };

  const setActive = (active: boolean) => {
    if (!member) return;
    if (!active && !confirm(`Deactivate ${name}? They're signed out and can't sign in until you reactivate them.`)) return;
    run(() => setTeamUserActive(member.id, active), { onDone: (r) => r.ok && onClose() });
  };

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-2xl"
      title={member ? (workspace === "demo" ? name : `Edit ${name}`) : "Add teammate"}
      hint={
        member
          ? member.email
          : "They sign in with this email and the password you set here — no invite email is sent."
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input name="full_name" required defaultValue={member?.full_name ?? ""} placeholder="Maya Fernando" autoComplete="off" />
          </Field>
          <Field label="Job title" hint="Optional — shown next to their name.">
            <Input name="title" defaultValue={member?.title ?? ""} placeholder="Project lead" autoComplete="off" />
          </Field>
          <Field label="Email" hint={member ? "Changing it changes how they sign in." : "What they sign in with."} className="sm:col-span-2">
            <Input
              name="email"
              type="email"
              required
              defaultValue={member?.email ?? ""}
              placeholder="maya@flowstate.lk"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </div>

        {/* Password — typed or generated, then handed over by the super admin */}
        <div>
          <label htmlFor="team-password" className={labelClass}>
            {member ? "New password" : "Password"}
          </label>
          <div className="flex gap-2">
            <Input
              id="team-password"
              name="password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={!member}
              minLength={8}
              autoComplete="new-password"
              spellCheck={false}
              placeholder={member ? "Leave blank to keep the current one" : "At least 8 characters"}
              className="min-w-0 font-mono"
            />
            <Button type="button" className="min-h-9 shrink-0" onClick={() => setPassword(generatePassword())} aria-label="Generate a password">
              <Icon.refresh size={13} />
              <span className="hidden sm:inline">Generate</span>
            </Button>
            <CopyButton value={password} />
          </div>
          <span className="mt-1 block text-[11px] text-sand/80">
            {member
              ? "Setting one signs them in with it from now on. Send it to them yourself."
              : "Send it to them yourself. They can change it from My account."}
          </span>
        </div>

        {/* Role and access */}
        <div className="border-t border-cream/[0.08] pt-4">
          <p className={labelClass}>Access</p>
          {superAdmin ? (
            <Notice tone="info" title="Super admin">
              Has everything, including Team & Users. The role can&apos;t be changed from here.
            </Notice>
          ) : (
            <>
              <input type="hidden" name="role" value={role} />
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Role">
                {(["admin", "member"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={role === r}
                    onClick={() => setRole(r)}
                    className={`min-h-9 border px-3 py-2 text-[12.5px] font-medium transition-colors duration-300 ${
                      role === r
                        ? "border-terra/50 bg-terra/15 text-terra-bright"
                        : "border-cream/12 bg-cream/[0.03] text-sand hover:text-cream"
                    }`}
                  >
                    {r === "admin" ? "Admin" : "Member"}
                  </button>
                ))}
              </div>

              {role === "admin" ? (
                <p className="mt-3 text-[12px] leading-relaxed text-sand">
                  Admins open every module except Team & Users, approve members&apos; expenses, invoices and leave,
                  and can change anyone&apos;s records.
                </p>
              ) : (
                <div className="mt-3">
                  <div className="mb-2.5 flex items-center justify-between gap-3">
                    <p className="text-[12px] text-sand">Tick what they can open. Approvals and My account are always on.</p>
                    <div className="flex shrink-0 gap-3">
                      <button
                        type="button"
                        onClick={() => setPerms([...GRANTABLE])}
                        className="min-h-9 text-[11.5px] text-sand transition-colors hover:text-cream sm:min-h-0"
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => setPerms([])}
                        className="min-h-9 text-[11.5px] text-sand transition-colors hover:text-cream sm:min-h-0"
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                    {GRANTABLE.map((key) => {
                      const def = MODULES.find((m) => m.key === key);
                      return (
                        <Checkbox
                          key={key}
                          name="permissions"
                          value={key}
                          checked={perms.includes(key)}
                          onChange={() => toggle(key)}
                          label={def?.label ?? key}
                          hint={def?.grantHint}
                          className="min-w-0"
                        />
                      );
                    })}
                  </div>
                  {gaps.length > 0 && (
                    <ul className="mt-3 space-y-1.5 border-t border-cream/[0.06] pt-3">
                      {gaps.map((g) => (
                        <li key={`${g.key}-${g.needs}`} className="flex gap-2 text-[11.5px] leading-snug text-amber-200/90">
                          <Icon.bolt size={12} className="mt-0.5 shrink-0" />
                          <span className="min-w-0">{g.hint}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {perms.length === 0 && (
                    <p className="mt-3 text-[11.5px] text-amber-200/90">
                      With nothing ticked they can sign in but only see My account and Approvals.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Deactivate / delete — never offered on your own row */}
        {member && !locked && (
          <div className="border-t border-cream/[0.08] pt-4">
            <p className={labelClass}>Account</p>
            <div className="flex flex-wrap gap-2">
              {member.is_active ? (
                <Button type="button" variant="danger" className="min-h-9" disabled={pending} onClick={() => setActive(false)}>
                  <Icon.lock size={13} /> Deactivate
                </Button>
              ) : (
                <Button type="button" className="min-h-9" disabled={pending} onClick={() => setActive(true)}>
                  <Icon.refresh size={13} /> Reactivate
                </Button>
              )}
              <Button
                type="button"
                variant="danger"
                className="min-h-9"
                disabled={pending}
                onClick={() => setConfirmText(confirmText === null ? "" : null)}
              >
                <Icon.trash size={13} /> Delete…
              </Button>
            </div>
            {!member.is_active && (
              <p className="mt-2 text-[11.5px] text-sand">Deactivated — their records stay, and they can&apos;t sign in.</p>
            )}

            {confirmText !== null && (
              <div className="mt-3 border border-rose-400/25 bg-rose-500/[0.06] p-3">
                <p className="text-[12px] leading-relaxed text-rose-100">
                  This deletes {name}&apos;s account for good. Records they made stay, without their name. Type{" "}
                  <span className="break-all font-mono">{member.email}</span> to confirm.
                </p>
                <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={member.email}
                    aria-label="Type their email to confirm"
                    autoComplete="off"
                    spellCheck={false}
                    className="min-w-0"
                  />
                  <Button
                    type="button"
                    variant="danger"
                    className="min-h-9 shrink-0"
                    disabled={pending || !confirmed}
                    onClick={() => run(() => deleteTeamUser(member.id, confirmText), { onDone: (r) => r.ok && onClose() })}
                  >
                    Delete for good
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-cream/[0.08] pt-3">
          {locked && <span className="mr-auto text-[11.5px] text-sand">{locked}</span>}
          <Button type="button" className="min-h-9" onClick={onClose}>
            {locked ? "Close" : "Cancel"}
          </Button>
          <Button type="submit" variant="primary" className="min-h-9" disabled={pending || !!locked} title={locked ?? undefined}>
            {member ? "Save changes" : "Create account"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
