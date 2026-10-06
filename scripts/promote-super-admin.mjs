#!/usr/bin/env node
/**
 * Make an existing account the super admin.
 *
 *   npm run admin:promote -- you@flowstate.lk
 *
 * Create the user first (Supabase → Authentication → Users → Add user, with
 * "Auto confirm" ticked). On a fresh project the first account is already
 * the super admin; this is the idempotent fallback. Uses the service role
 * from .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 */
import { createClient } from "@supabase/supabase-js";

const email = (process.argv[2] ?? "").trim().toLowerCase();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !email.includes("@")) {
  console.error("Usage: npm run admin:promote -- you@example.com");
  process.exit(1);
}
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const { data: profile, error } = await admin
  .from("profiles")
  .select("id, email, role, workspace, is_active")
  .eq("email", email)
  .maybeSingle();

if (error) {
  console.error(`Couldn't read profiles: ${error.message}\nHave all the migrations been run on this project?`);
  process.exit(1);
}
if (!profile) {
  console.error(`No account for ${email}. Create it in Supabase → Authentication → Users first.`);
  process.exit(1);
}
if (profile.workspace === "demo") {
  console.error(`${email} belongs to the demo workspace and can't be the super admin.`);
  process.exit(1);
}

const { error: unban } = await admin.auth.admin.updateUserById(profile.id, { ban_duration: "none" });
if (unban) console.warn(`Note: couldn't clear a ban on the auth user (${unban.message}).`);

const { error: update } = await admin
  .from("profiles")
  .update({ role: "super_admin", workspace: "live", is_active: true, permissions: [] })
  .eq("id", profile.id);

if (update) {
  console.error(`Couldn't promote ${email}: ${update.message}`);
  process.exit(1);
}

console.log(
  profile.role === "super_admin" && profile.is_active
    ? `${email} was already the super admin — nothing changed.`
    : `${email} is now the super admin (was: ${profile.role}${profile.is_active ? "" : ", inactive"}).`,
);
