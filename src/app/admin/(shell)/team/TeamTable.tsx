"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Icon } from "@/components/admin/icons";
import { useAction } from "@/components/admin/useAction";
import { Avatar, Badge, Button, EmptyState, Panel } from "@/components/admin/ui";
import { displayName, formatDateTime, relativeTime } from "@/lib/admin/format";
import { GRANTABLE, moduleLabel } from "@/lib/admin/modules";
import { ROLE_LABEL, type TeamMember, type Workspace } from "@/lib/admin/types";
import UserModal from "./UserModal";

export type TeamRow = TeamMember & {
  created_at: string;
  /** From Supabase Auth; null when they never signed in or it can't be read (demo, no key). */
  last_sign_in_at: string | null;
};

const ROLE_TONE = { super_admin: "terra", admin: "cream", member: "neutral", viewer: "muted" } as const;

/** What someone can open, in words — the table's "Access" column. */
export function accessText(m: Pick<TeamMember, "role" | "permissions">, workspace: Workspace) {
  if (m.role === "super_admin") return "Everything";
  if (m.role === "admin") return workspace === "demo" ? "Everything except Email" : "Everything except Team & Users";
  if (m.role === "viewer") return "No access";
  const labels = GRANTABLE.filter((k) => m.permissions.includes(k)).map(moduleLabel);
  return labels.length ? labels.join(", ") : "No modules yet";
}

function statusOf(m: TeamRow) {
  if (!m.is_active) return { label: "Deactivated", tone: "danger" as const };
  if (m.role === "viewer") return { label: "No access", tone: "warn" as const };
  return { label: "Active", tone: "success" as const };
}

export default function TeamTable({
  members,
  meId,
  workspace,
  locked,
  showSignIns,
  openId,
}: {
  members: TeamRow[];
  meId: string;
  workspace: Workspace;
  /** Why saving is off (demo, missing key); null when the super admin can change things. */
  locked: string | null;
  showSignIns: boolean;
  /** `?user=<id>` — open that person's form on load. */
  openId?: string;
}) {
  const { run, pending, toast } = useAction();
  // `member: null` = the add form. Seeded once from the deep link.
  const [modal, setModal] = useState<{ member: TeamRow | null } | null>(() => {
    const target = members.find((m) => m.id === openId && m.id !== meId);
    return target ? { member: target } : null;
  });

  // Stable, so the dialog's focus/scroll-lock effect doesn't re-run on every refresh.
  const close = useCallback(() => setModal(null), []);

  const active = members.filter((m) => m.is_active && m.role !== "viewer").length;
  const open = (member: TeamRow) => member.id !== meId && setModal({ member });

  const signIn = (m: TeamRow) =>
    !showSignIns ? "—" : m.last_sign_in_at ? relativeTime(m.last_sign_in_at) : "Never";

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[11px] text-sand tabular-nums">
          {members.length} {members.length === 1 ? "person" : "people"} · {active} with access
        </p>
        <Button variant="primary" className="min-h-9" data-shortcut="new" onClick={() => setModal({ member: null })}>
          <Icon.plus size={13} /> Add teammate
        </Button>
      </div>

      <Panel bodyClass="p-0">
        {members.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Nobody here yet" hint="Add a teammate — they sign in with the email and password you set." />
          </div>
        ) : (
          <>
            {/* md and up: the table */}
            <div className="hidden overflow-x-auto scroll-thin md:block" data-lenis-prevent>
              <table className="w-full min-w-[860px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-cream/[0.08] text-[10px] uppercase tracking-[0.16em] text-sand">
                    <th className="px-3 py-2.5 font-normal">Person</th>
                    <th className="px-3 py-2.5 font-normal">Title</th>
                    <th className="px-3 py-2.5 font-normal">Role</th>
                    <th className="px-3 py-2.5 font-normal">Access</th>
                    <th className="px-3 py-2.5 font-normal">Status</th>
                    <th className="px-3 py-2.5 font-normal">Last sign-in</th>
                    <th className="w-24 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const me = m.id === meId;
                    const status = statusOf(m);
                    return (
                      <tr
                        key={m.id}
                        className={`border-b border-cream/[0.05] transition-colors last:border-0 hover:bg-cream/[0.03] ${m.is_active ? "" : "opacity-60"}`}
                      >
                        <td className="max-w-[260px] px-3 py-3">
                          <button
                            type="button"
                            onClick={() => open(m)}
                            disabled={me}
                            className="flex max-w-full items-center gap-2.5 text-left disabled:cursor-default"
                          >
                            <Avatar name={displayName(m)} size={30} />
                            <span className="min-w-0">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-[13px] font-medium text-cream">{displayName(m)}</span>
                                {me && <Badge tone="terra">You</Badge>}
                              </span>
                              <span className="block truncate text-[11px] text-sand">{m.email}</span>
                            </span>
                          </button>
                        </td>
                        <td className="max-w-[160px] px-3 py-3 text-[12px] text-cream-2">
                          <span className="block truncate">{m.title || "—"}</span>
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
                        </td>
                        <td className="max-w-[280px] px-3 py-3 text-[12px] leading-snug text-cream-2">
                          {accessText(m, workspace)}
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </td>
                        <td
                          className="whitespace-nowrap px-3 py-3 text-[11.5px] text-sand"
                          title={showSignIns && m.last_sign_in_at ? formatDateTime(m.last_sign_in_at) : undefined}
                        >
                          {signIn(m)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {me ? (
                            <Link href="/admin/account" className="text-[11.5px] text-sand transition-colors hover:text-cream">
                              My account
                            </Link>
                          ) : (
                            <button
                              type="button"
                              onClick={() => open(m)}
                              className="inline-flex items-center gap-1.5 text-[11.5px] text-sand transition-colors hover:text-cream"
                            >
                              <Icon.edit size={13} /> {workspace === "demo" ? "View" : "Edit"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* below md: one card per person — the whole card opens the form */}
            <ul className="md:hidden">
              {members.map((m) => {
                const me = m.id === meId;
                const status = statusOf(m);
                const body = (
                  <>
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-sand">
                      {ROLE_LABEL[m.role]} · {status.label} · {signIn(m)}
                    </p>
                    <div className="mt-2 flex min-w-0 items-center gap-2.5">
                      <Avatar name={displayName(m)} size={30} />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-cream">
                          {displayName(m)}
                          {me && <span className="ml-1.5 text-[11px] text-terra-bright">(you)</span>}
                        </span>
                        <span className="block truncate text-[11px] text-sand">{m.email}</span>
                      </span>
                    </div>
                    <p className="mt-2 text-[11.5px] leading-snug text-sand">{accessText(m, workspace)}</p>
                  </>
                );
                return (
                  <li key={m.id} className={`border-b border-cream/[0.05] last:border-0 ${m.is_active ? "" : "opacity-60"}`}>
                    {me ? (
                      <Link href="/admin/account" className="block min-w-0 px-4 py-3.5">
                        {body}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => open(m)}
                        className="block w-full min-w-0 px-4 py-3.5 text-left transition-colors active:bg-cream/[0.04]"
                      >
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel>

      {modal && (
        <UserModal
          key={modal.member?.id ?? "new"}
          member={modal.member}
          workspace={workspace}
          locked={locked}
          run={run}
          pending={pending}
          onClose={close}
        />
      )}

      {toast}
    </>
  );
}
