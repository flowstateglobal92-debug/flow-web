"use client";

import { useState } from "react";
import { Icon } from "@/components/admin/icons";
import { useAction } from "@/components/admin/useAction";
import { Avatar, Badge, Button, Notice, Panel } from "@/components/admin/ui";
import { displayName, formatDateTime, relativeTime } from "@/lib/admin/format";
import type { Role } from "@/lib/admin/types";
import { resetDemoWorkspace } from "@/app/admin/actions/team";
import { CopyButton } from "./UserModal";

export type DemoAccount = { id: string; email: string; full_name: string | null; title: string | null; role: Role };

function Credential({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border border-cream/[0.08] bg-ink/40 px-3 py-2">
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-sand">{label}</p>
        <p className="mt-0.5 break-all font-mono text-[13px] text-cream">{value}</p>
      </div>
      <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
    </div>
  );
}

/**
 * The demo workspace from the live side: the shareable login, when the sample
 * data was last rebuilt, and the button that creates or resets it all.
 */
export default function DemoPanel({
  email,
  password,
  resetAt,
  accounts,
  ready,
  staleHours,
}: {
  email: string;
  password: string;
  resetAt: string | null;
  accounts: DemoAccount[];
  ready: boolean;
  staleHours: number;
}) {
  const { run, pending, toast } = useAction();
  // GoTrue's own words stay on screen until the next try — the toast is too brief for them.
  const [error, setError] = useState<string | null>(null);

  const login = accounts.find((a) => a.role === "admin");
  const mates = accounts.filter((a) => a.role !== "admin");

  const go = () => {
    if (login && !confirm("Reset the demo? Everything visitors changed is wiped and the sample data is rebuilt.")) return;
    setError(null);
    run(() => resetDemoWorkspace(), { onDone: (r) => setError(r.ok ? null : (r.error ?? "That didn't work.")) });
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Demo login" hint="Share it with prospects — it only ever sees the demo workspace.">
          <div className="space-y-2">
            <Credential label="Email" value={email} />
            <Credential label="Password" value={password} />
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-sand">
            Sign in at <span className="font-mono text-cream-2">/admin/login</span>. Email is hidden there and Team &
            Users is read-only. Nobody can lock it: when this password stops working, the next sign-in with it puts
            the email and password back.
          </p>
        </Panel>

        <Panel
          title="Sample data"
          hint={`Rebuilt when someone signs in after ${staleHours} hours, and nightly when pg_cron is on.`}
          right={login ? <Badge tone="success">Ready</Badge> : <Badge tone="muted">Not created</Badge>}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-sand">Last reset</p>
          <p className="mt-1 text-[13px] text-cream">
            {resetAt ? (
              <>
                {formatDateTime(resetAt)} <span className="text-sand">· {relativeTime(resetAt)}</span>
              </>
            ) : (
              "Never"
            )}
          </p>

          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-sand">Accounts</p>
          {accounts.length === 0 ? (
            <p className="mt-1 text-[12px] text-sand">
              {ready ? "Not created yet — the button below makes the login and three fictional teammates." : "—"}
            </p>
          ) : (
            <ul className="mt-1.5">
              {[...(login ? [login] : []), ...mates].map((a) => (
                <li key={a.id} className="flex items-center gap-2.5 border-b border-cream/[0.05] py-2 last:border-0">
                  <Avatar name={displayName(a)} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-cream">{displayName(a)}</span>
                    <span className="block truncate text-[11px] text-sand">{a.title || a.email}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-sand">
                    {a.role === "admin" ? "Demo login" : "Can't sign in"}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <div className="mt-4">
              <Notice tone="danger" title="Supabase said">
                <span className="break-words">{error}</span>
              </Notice>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-cream/[0.08] pt-4">
            <Button variant="primary" className="min-h-9" disabled={!ready || pending} onClick={go}>
              <Icon.refresh size={13} /> {pending ? "Working…" : login ? "Reset demo now" : "Create demo account"}
            </Button>
            {!ready && <span className="text-[11.5px] text-sand">Needs the service-role key.</span>}
          </div>
        </Panel>
      </div>
      {toast}
    </>
  );
}
