"use client";

import { useActionState } from "react";
import { signIn, signOut, type AuthState } from "../actions/auth";
import { Field, Input } from "@/components/admin/ui";
import { Icon } from "@/components/admin/icons";

const initial: AuthState = { error: null };

export default function LoginForm({ next, denied }: { next?: string; denied?: boolean }) {
  const [state, action, pending] = useActionState(signIn, initial);

  return (
    <form action={action} className="space-y-4">
      {denied && (
        <div className="flex items-start gap-2.5 border border-warn-300/25 bg-warn-400/[0.07] px-3.5 py-2.5 text-[12px] text-warn-100">
          <span className="mt-0.5 shrink-0">
            <Icon.lock size={14} />
          </span>
          <span>
            You&apos;re signed in, but that account doesn&apos;t have access.{" "}
            <button
              type="button"
              onClick={() => void signOut()}
              className="underline underline-offset-4 transition-colors hover:text-cream"
            >
              Sign out
            </button>{" "}
            and use an account your administrator set up.
          </span>
        </div>
      )}

      <input type="hidden" name="next" value={next ?? "/admin"} />

      <Field label="Email">
        <Input name="email" type="email" required autoComplete="email" placeholder="you@flowstate.lk" />
      </Field>

      <Field label="Password">
        <Input name="password" type="password" required autoComplete="current-password" placeholder="••••••••" />
      </Field>

      {state.error && (
        <p role="alert" className="border border-bad-400/25 bg-bad-500/[0.08] px-3.5 py-2.5 text-[12px] text-bad-200">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn btn--primary btn--anim w-full disabled:opacity-60">
        <span className="btn__label">{pending ? "Signing in…" : "Sign in"}</span>
        <span className="btn__arrow">
          <Icon.arrow size={14} />
        </span>
      </button>
    </form>
  );
}
