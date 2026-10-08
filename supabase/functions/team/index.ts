// Team & Users for the desktop app.
//
// Accounts live in Supabase Auth, and creating, banning and deleting them
// needs the service-role key — which must never ship inside an installer.
// This function holds it. It does exactly what the web admin's Server
// Actions do (src/app/admin/actions/team.ts), with the same rules and
// sentences (_shared/team-core.ts, generated from src/lib/admin/team-core.ts):
// the caller must be the live super admin, and every target is looked up
// with the caller's own session first, so nothing outside their workspace
// can be touched.
//
// POST { op: "list" | "create" | "update" | "setActive" | "delete", … }
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BAN_FOREVER, EMAIL_TAKEN, EMAIL_TAKEN_MESSAGE, checkAccount, createdMessage } from "../_shared/team-core.ts";
import { body, caller, failed, reply, str, UUID, type Caller } from "../_shared/http.ts";

/** src/lib/admin/modules.ts → GRANTABLE (the database's profiles_permissions_check backs it). */
const GRANTABLE = [
  "dashboard", "calendar", "todos", "workload", "inquiries", "email", "crm", "clients", "invoices", "finance", "reports",
] as const;
/** src/lib/admin/demo.ts → DEMO_EMAIL. */
const DEMO_EMAIL = "demo@flowstate.com";

type Target = { id: string; email: string; full_name: string | null; role: string; is_active: boolean };

const displayName = (m: { full_name: string | null; email: string }) => m.full_name || m.email.split("@")[0];

let admin: SupabaseClient | null = null;
function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Team management isn't available on the server.");
  admin ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return admin;
}

function fields(value: unknown) {
  const f = (value ?? {}) as Record<string, unknown>;
  return {
    full_name: str(f.full_name),
    email: str(f.email),
    title: str(f.title),
    password: str(f.password),
    role: str(f.role),
    permissions: Array.isArray(f.permissions) ? f.permissions.map(String) : [],
  };
}

/** Someone on my team (RLS keeps it to my workspace) — never myself. */
async function loadTarget(who: Caller, id: string): Promise<Target> {
  if (id === who.user.id) throw new Error("That's you — change your own profile from My account.");
  if (!UUID.test(id)) throw new Error("That account isn't on the team any more.");
  const { data } = await who.supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", id)
    .maybeSingle<Target>();
  if (!data) throw new Error("That account isn't on the team any more.");
  return data;
}

async function setProfile(id: string, values: Record<string, unknown>) {
  const { data, error } = await adminClient().from("profiles").update(values).eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("That account's profile is missing.");
}

/** Last sign-in for everyone the caller can see — Auth knows it, profiles don't. */
async function list(who: Caller) {
  const { data: people } = await who.supabase.from("profiles").select("id").returns<{ id: string }[]>();
  const visible = new Set((people ?? []).map((p) => p.id));
  const users: { id: string; last_sign_in_at: string | null }[] = [];
  for (let page = 1; page < 50; page++) {
    const { data, error } = await adminClient().auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (visible.has(u.id)) users.push({ id: u.id, last_sign_in_at: u.last_sign_in_at ?? null });
    if (data.users.length < 1000) break;
  }
  return reply({ ok: true, data: { users } });
}

async function create(args: Record<string, unknown>) {
  const input = checkAccount(fields(args.fields), { passwordRequired: true, grantable: GRANTABLE, demoEmail: DEMO_EMAIL });
  const { data, error } = await adminClient().auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });
  if (error) {
    if (EMAIL_TAKEN.test(error.message)) return reply({ ok: false, error: EMAIL_TAKEN_MESSAGE });
    throw error;
  }
  const id = data.user.id;
  // The signup trigger made them a viewer; give them the access asked for.
  // If that fails, don't leave a half-made account that can sign in to nothing.
  try {
    await setProfile(id, {
      full_name: input.full_name,
      title: input.title,
      email: input.email,
      role: input.role,
      permissions: input.permissions,
      workspace: "live",
      is_active: true,
    });
  } catch (e) {
    await adminClient().auth.admin.deleteUser(id);
    throw e;
  }
  return reply({ ok: true, message: createdMessage(input), id });
}

async function update(who: Caller, args: Record<string, unknown>) {
  const id = str(args.id);
  const target = await loadTarget(who, id);
  const input = checkAccount(fields(args.fields), { passwordRequired: false, grantable: GRANTABLE, demoEmail: DEMO_EMAIL });

  // Auth first: a taken email fails here, before anything has changed.
  const emailChanged = input.email !== target.email.toLowerCase();
  if (emailChanged || input.password) {
    const { error } = await adminClient().auth.admin.updateUserById(id, {
      ...(emailChanged ? { email: input.email, email_confirm: true } : {}),
      ...(input.password ? { password: input.password } : {}),
    });
    if (error) throw error;
  }

  // Super admins keep their role — this form only knows Admin and Member.
  const access = target.role === "super_admin" ? {} : { role: input.role, permissions: input.permissions };
  try {
    await setProfile(id, { full_name: input.full_name, title: input.title, email: input.email, ...access });
  } catch (e) {
    if (emailChanged) await adminClient().auth.admin.updateUserById(id, { email: target.email, email_confirm: true });
    throw e;
  }
  return reply({ ok: true, message: input.password ? "Saved — the new password works now." : "Saved.", id });
}

async function setActive(who: Caller, args: Record<string, unknown>) {
  const id = str(args.id);
  const target = await loadTarget(who, id);
  const name = displayName(target);
  if (args.active === true) {
    const { error } = await adminClient().auth.admin.updateUserById(id, { ban_duration: "none" });
    if (error) throw error;
    await setProfile(id, { is_active: true });
    return reply({ ok: true, message: `${name} can sign in again.`, id });
  }
  // Profile first: RLS shuts them out the moment it flips, and the
  // last-super-admin guard gets its say before Auth is touched.
  await setProfile(id, { is_active: false });
  const { error } = await adminClient().auth.admin.updateUserById(id, { ban_duration: BAN_FOREVER });
  if (error) throw error;
  return reply({ ok: true, message: `${name} is deactivated and can't sign in.`, id });
}

async function remove(who: Caller, args: Record<string, unknown>) {
  const target = await loadTarget(who, str(args.id));
  if (str(args.confirmEmail).trim().toLowerCase() !== target.email.toLowerCase()) {
    return reply({ ok: false, error: "Type their email exactly to confirm." });
  }
  // Deleting the auth user cascades to the profile; records they made keep
  // their content and lose the name (created_by / owner → null).
  const { error } = await adminClient().auth.admin.deleteUser(target.id);
  if (error) throw new Error(`${error.message} — they may still be linked to records. Deactivate them instead.`);
  return reply({ ok: true, message: `${displayName(target)} was deleted.` });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ ok: false, error: "POST only." }, 405);
  try {
    const who = await caller(req);
    if (!who) return reply({ ok: false, error: "Your session has ended. Sign in again." }, 401);

    // The live super admin only — the same gate as authorizeSuperAdmin().
    const { data: superAdmin } = await who.supabase.rpc("is_super_admin");
    if (superAdmin !== true) return reply({ ok: false, error: "Only the super admin can do that." }, 403);

    const args = await body(req);
    if (!args) return reply({ ok: false, error: "Send a JSON body." }, 400);

    switch (args.op) {
      case "list":
        return await list(who);
      case "create":
        return await create(args);
      case "update":
        return await update(who, args);
      case "setActive":
        return await setActive(who, args);
      case "delete":
        return await remove(who, args);
      default:
        return reply({ ok: false, error: "Unknown request." }, 400);
    }
  } catch (e) {
    return failed(e);
  }
});
