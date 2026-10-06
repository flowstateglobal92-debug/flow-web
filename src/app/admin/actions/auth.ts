"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_READY } from "@/lib/supabase/env";
import { serviceRoleReady } from "@/lib/supabase/admin";
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/lib/admin/demo";
import { healDemoLogin, refreshDemoIfStale } from "@/lib/admin/demo-server";
import { canOpenPath, firstAllowedHref } from "@/lib/admin/modules";
import { clientAddress, hit } from "@/lib/admin/rate-limit";
import type { Profile } from "@/lib/admin/types";

export type AuthState = { error: string | null };

type Gate = Pick<Profile, "role" | "permissions" | "workspace" | "is_active">;

/** Sign-in attempts allowed per address in each window. */
const ATTEMPTS = 10;
const WINDOW_MS = 10 * 60_000;

/**
 * Email + password sign-in. There is no public signup: the super admin issues
 * accounts from Team & Users. Anyone without an active role (a viewer, a
 * deactivated account) is refused here rather than bounced off the gates.
 *
 * The demo login is public, so it gets two extras. If the public password
 * fails to open it (a visitor changed it through the Auth API), it is
 * repaired — throttled — and tried once more; a wrong password never triggers
 * that. After a good demo sign-in, sample data older than DEMO_STALE_HOURS is
 * reseeded.
 */
export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!SUPABASE_READY) {
    return { error: "Supabase is not configured. Add the keys to .env.local and restart the server." };
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/admin");

  if (!email || !password) return { error: "Enter your email and password." };

  const limit = hit(`sign-in:${await clientAddress()}`, ATTEMPTS, WINDOW_MS);
  if (!limit.ok) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    return { error: `Too many sign-in attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.` };
  }

  const supabase = await createClient();
  const attempt = async () => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) return { error, user: null, profile: null };
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, permissions, workspace, is_active")
      .eq("id", data.user.id)
      .maybeSingle<Gate>();
    return { error: null, user: data.user, profile: profile ?? null };
  };

  const isDemoLogin = email.toLowerCase() === DEMO_EMAIL;
  let result = await attempt();

  const demoBroken =
    isDemoLogin &&
    password === DEMO_PASSWORD &&
    result.error?.status !== 429 &&
    (!result.profile || result.profile.workspace !== "demo" || !result.profile.is_active || result.profile.role === "viewer");
  if (demoBroken && serviceRoleReady() && (await healDemoLogin())) {
    // The repair reset the password, which signed out any session just made.
    result = await attempt();
  }

  if (result.error || !result.user) {
    return { error: result.error?.message ?? "Could not sign you in." };
  }
  const { profile } = result;

  // The demo password is public: never let it open anything but the sandbox.
  const demoLeak = isDemoLogin && profile?.workspace !== "demo";

  if (!profile || !profile.is_active || profile.role === "viewer" || demoLeak) {
    await supabase.auth.signOut();
    return {
      error: demoLeak
        ? "The demo isn't set up yet. Ask the administrator to create it from Team & Users."
        : "That account doesn't have access yet. Ask your administrator.",
    };
  }

  if (isDemoLogin && serviceRoleReady()) await refreshDemoIfStale();

  revalidatePath("/admin", "layout");
  // Only same-origin paths the account may open — never an attacker-supplied URL.
  redirect(canOpenPath(profile, next) ? next : firstAllowedHref(profile));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/admin", "layout");
  redirect("/admin/login");
}
