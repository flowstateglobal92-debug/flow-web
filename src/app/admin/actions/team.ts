"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeSuperAdmin, type Session } from "@/lib/admin/auth";
import { DEMO_EMAIL } from "@/lib/admin/demo";
import { ensureDemoUsers, resetDemoData } from "@/lib/admin/demo-server";
import { GRANTABLE } from "@/lib/admin/modules";
import { displayName } from "@/lib/admin/team";
import { BAN_FOREVER, EMAIL_TAKEN, EMAIL_TAKEN_MESSAGE, checkAccount, createdMessage } from "@/lib/admin/team-core";
import type { Role } from "@/lib/admin/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, text, type ActionResult } from "./shared";

/**
 * Team & Users — the only place accounts are created, changed and removed.
 *
 * Every action is super-admin only (the demo admin's Team page is read-only,
 * and authorizeSuperAdmin() says so). Accounts live in Supabase Auth, so the
 * writes go through the service role; the target is always looked up with the
 * caller's own session first, which keeps every change inside the live
 * workspace and off the demo accounts.
 */

type Target = { id: string; email: string; full_name: string | null; role: Role; is_active: boolean };

/** The form, checked by the rules the desktop app's team function shares (@/lib/admin/team-core). */
function readAccount(formData: FormData, { passwordRequired }: { passwordRequired: boolean }) {
  return checkAccount(
    {
      full_name: text(formData, "full_name"),
      email: text(formData, "email"),
      title: text(formData, "title"),
      password: String(formData.get("password") ?? ""),
      role: text(formData, "role"),
      permissions: formData.getAll("permissions").map(String),
    },
    { passwordRequired, grantable: GRANTABLE, demoEmail: DEMO_EMAIL },
  );
}

/** Someone on my team (RLS keeps it to the live workspace) — never myself. */
async function loadTarget(supabase: Session["supabase"], id: string, me: string): Promise<Target> {
  if (id === me) throw new Error("That's you — change your own profile from My account.");
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", id)
    .maybeSingle<Target>();
  if (!data) throw new Error("That account isn't on the team any more.");
  return data;
}

async function setProfile(admin: SupabaseClient, id: string, values: Record<string, unknown>) {
  const { data, error } = await admin.from("profiles").update(values).eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("That account's profile is missing.");
}

export async function createTeamUser(formData: FormData): Promise<ActionResult> {
  try {
    await authorizeSuperAdmin();
    const input = readAccount(formData, { passwordRequired: true });
    const admin = createAdminClient();

    const { data, error } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.full_name },
    });
    if (error) {
      // Usually someone who signed up on their own: they're in the list as "No access".
      if (EMAIL_TAKEN.test(error.message)) {
        return { ok: false, error: EMAIL_TAKEN_MESSAGE };
      }
      throw error;
    }
    const id = data.user.id;

    // The signup trigger made them a viewer; give them the access asked for.
    // If that fails, don't leave a half-made account that can sign in to nothing.
    try {
      await setProfile(admin, id, {
        full_name: input.full_name,
        title: input.title,
        email: input.email,
        role: input.role,
        permissions: input.permissions,
        workspace: "live",
        is_active: true,
      });
    } catch (e) {
      await admin.auth.admin.deleteUser(id);
      throw e;
    }

    revalidatePath("/admin/team");
    return ok(createdMessage(input), id);
  } catch (e) {
    return fail(e);
  }
}

/** Name, email, title, access — and a new password when one is typed. */
export async function updateTeamUser(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorizeSuperAdmin();
    const target = await loadTarget(supabase, id, profile.id);
    const input = readAccount(formData, { passwordRequired: false });
    const admin = createAdminClient();

    // Auth first: a taken email fails here, before anything has changed.
    const emailChanged = input.email !== target.email.toLowerCase();
    if (emailChanged || input.password) {
      const { error } = await admin.auth.admin.updateUserById(id, {
        ...(emailChanged ? { email: input.email, email_confirm: true } : {}),
        ...(input.password ? { password: input.password } : {}),
      });
      if (error) throw error;
    }

    // Super admins keep their role — this form only knows Admin and Member.
    const access = target.role === "super_admin" ? {} : { role: input.role, permissions: input.permissions };
    try {
      await setProfile(admin, id, { full_name: input.full_name, title: input.title, email: input.email, ...access });
    } catch (e) {
      if (emailChanged) await admin.auth.admin.updateUserById(id, { email: target.email, email_confirm: true });
      throw e;
    }

    revalidatePath("/admin/team");
    return ok(input.password ? "Saved — the new password works now." : "Saved.", id);
  } catch (e) {
    return fail(e);
  }
}

/** Deactivate (profile off + banned in Auth) or bring someone back. */
export async function setTeamUserActive(id: string, active: boolean): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorizeSuperAdmin();
    const target = await loadTarget(supabase, id, profile.id);
    const admin = createAdminClient();
    const name = displayName(target);

    if (active) {
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: "none" });
      if (error) throw error;
      await setProfile(admin, id, { is_active: true });
    } else {
      // Profile first: RLS shuts them out the moment it flips, and the
      // last-super-admin guard gets its say before Auth is touched.
      await setProfile(admin, id, { is_active: false });
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: BAN_FOREVER });
      if (error) throw error;
    }

    revalidatePath("/admin/team");
    return ok(active ? `${name} can sign in again.` : `${name} is deactivated and can't sign in.`, id);
  } catch (e) {
    return fail(e);
  }
}

/** Remove the account for good. The caller types the email back to confirm. */
export async function deleteTeamUser(id: string, confirmEmail: string): Promise<ActionResult> {
  try {
    const { supabase, profile } = await authorizeSuperAdmin();
    const target = await loadTarget(supabase, id, profile.id);
    if (confirmEmail.trim().toLowerCase() !== target.email.toLowerCase()) {
      return { ok: false, error: "Type their email exactly to confirm." };
    }

    // Deleting the auth user cascades to the profile; records they made keep
    // their content and lose the name (created_by / owner → null).
    const { error } = await createAdminClient().auth.admin.deleteUser(id);
    if (error) {
      throw new Error(`${error.message} — they may still be linked to records. Deactivate them instead.`);
    }

    revalidatePath("/admin/team");
    return ok(`${displayName(target)} was deleted.`);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Create or repair the demo login and its fictional teammates, then wipe and
 * reseed the sample data. Errors come back exactly as Supabase sent them — a
 * GoTrue complaint (password policy, signups disabled …) is the fix's best clue.
 */
export async function resetDemoWorkspace(): Promise<ActionResult> {
  try {
    await authorizeSuperAdmin();
  } catch (e) {
    return fail(e);
  }
  try {
    const ids = await ensureDemoUsers();
    await resetDemoData(ids);
    revalidatePath("/admin/team");
    return ok("The demo workspace is fresh.");
  } catch (e) {
    return { ok: false, error: rawMessage(e) };
  }
}

function rawMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e && "message" in e) {
    const { message, details, hint } = e as { message?: unknown; details?: unknown; hint?: unknown };
    return [message, details, hint].filter(Boolean).map(String).join(" · ");
  }
  return String(e ?? "Something went wrong.");
}
