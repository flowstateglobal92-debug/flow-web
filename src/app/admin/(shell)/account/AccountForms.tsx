"use client";

import { useRef } from "react";
import { Button, Field, Input, Panel } from "@/components/admin/ui";
import { useAction } from "@/components/admin/useAction";
import { changeMyPassword, updateMyProfile } from "@/app/admin/actions/account";

export default function AccountForms({
  fullName,
  title,
  email,
  demo,
}: {
  fullName: string;
  title: string;
  email: string;
  demo: boolean;
}) {
  const { run, pending, toast } = useAction();
  const passwordForm = useRef<HTMLFormElement>(null);

  return (
    <>
      <Panel title="Profile" hint="How you appear to the team — on avatars, mentions and the activity log.">
        <form
          action={(fd) => run(() => updateMyProfile(fd))}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <Field label="Name">
            <Input name="full_name" defaultValue={fullName} required autoComplete="name" />
          </Field>
          <Field label="Job title" hint="Optional.">
            <Input name="title" defaultValue={title} placeholder="e.g. Project lead" />
          </Field>
          <Field label="Email" hint="Ask the super admin to change it." className="sm:col-span-2">
            <Input value={email} disabled readOnly />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" disabled={pending}>
              Save profile
            </Button>
          </div>
        </form>
      </Panel>

      <Panel title="Password" hint={demo ? "The demo account's password is fixed." : "At least 8 characters."}>
        {demo ? (
          <p className="text-[12px] text-sand">Password changes are disabled in the demo workspace.</p>
        ) : (
          <form
            ref={passwordForm}
            action={(fd) =>
              run(() => changeMyPassword(fd), { onDone: (r) => r.ok && passwordForm.current?.reset() })
            }
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            <Field label="Current password">
              <Input name="current" type="password" required autoComplete="current-password" />
            </Field>
            <Field label="New password">
              <Input name="next" type="password" required minLength={8} autoComplete="new-password" />
            </Field>
            <Field label="Confirm new password">
              <Input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
            </Field>
            <div className="sm:col-span-3">
              <Button type="submit" disabled={pending}>
                Change password
              </Button>
            </div>
          </form>
        )}
      </Panel>
      {toast}
    </>
  );
}
