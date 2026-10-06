import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_PROFILE, DEMO_STALE_HOURS, DEMO_TEAM } from "./demo";

/**
 * Demo account upkeep, all through the service role.
 *
 * Accounts are recognised by `app_metadata.demo_key` (which only the admin
 * API can write), never by email — a visitor can change the demo's email or
 * password through the public Auth API, and the heal below undoes it.
 */

type DemoMeta = { demo?: boolean; demo_key?: string };

async function listAllUsers(admin: SupabaseClient) {
  const users: User[] = [];
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

const keyOf = (u: User) => (u.app_metadata as DemoMeta | undefined)?.demo_key;

function randomPassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

async function dropFactors(admin: SupabaseClient, userId: string) {
  const { data } = await admin.auth.admin.mfa.listFactors({ userId });
  for (const f of data?.factors ?? []) {
    await admin.auth.admin.mfa.deleteFactor({ userId, id: f.id });
  }
}

/**
 * Create or repair the demo login + teammates. Returns their ids in DEMO_TEAM order.
 *
 * `repairLogin: false` leaves the shared login's email, password and factors
 * alone. Use it right after someone signed in with them: GoTrue signs every
 * session out when the admin API sets a password, the new one included.
 */
export async function ensureDemoUsers({ repairLogin = true }: { repairLogin?: boolean } = {}) {
  const admin = createAdminClient();
  const users = await listAllUsers(admin);

  // ── the shared demo login
  let primary = users.find((u) => keyOf(u) === "primary");
  if (!primary) {
    // Someone may have created demo@… by hand: adopt it rather than fail.
    const existing = users.find((u) => u.email?.toLowerCase() === DEMO_EMAIL);
    if (existing) {
      const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
        app_metadata: { demo: true, demo_key: "primary" },
      });
      if (error) throw error;
      primary = data.user;
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        email_confirm: true,
        app_metadata: { demo: true, demo_key: "primary" },
        user_metadata: { full_name: DEMO_PROFILE.full_name },
      });
      if (error) throw error;
      primary = data.user;
    }
  }

  // Undo anything a visitor changed through the Auth API.
  if (repairLogin) {
    const { error } = await admin.auth.admin.updateUserById(primary.id, {
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
      ban_duration: "none",
    });
    if (error) throw error;
    await dropFactors(admin, primary.id);
  }

  await setProfile(admin, primary.id, {
    role: "admin",
    workspace: "demo",
    is_active: true,
    permissions: [],
    full_name: DEMO_PROFILE.full_name,
    title: DEMO_PROFILE.title,
    email: DEMO_EMAIL,
  });

  // ── fictional teammates (can never sign in)
  const teamIds: string[] = [];
  for (const mate of DEMO_TEAM) {
    let user = users.find((u) => keyOf(u) === mate.key);
    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({
        email: mate.email,
        password: randomPassword(),
        email_confirm: true,
        ban_duration: "876000h",
        app_metadata: { demo: true, demo_key: mate.key },
        user_metadata: { full_name: mate.full_name },
      });
      if (error) throw error;
      user = data.user;
    } else {
      await admin.auth.admin.updateUserById(user.id, { ban_duration: "876000h" });
    }
    await setProfile(admin, user.id, {
      role: "member",
      workspace: "demo",
      is_active: true,
      permissions: mate.permissions,
      full_name: mate.full_name,
      title: mate.title,
      email: mate.email,
    });
    teamIds.push(user.id);
  }

  // ── anything else flagged as demo is a leftover (e.g. an old detached copy)
  const expected = new Set([primary.id, ...teamIds]);
  for (const u of users) {
    if ((u.app_metadata as DemoMeta | undefined)?.demo && !expected.has(u.id)) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }

  return { demoId: primary.id, teamIds };
}

async function setProfile(admin: SupabaseClient, id: string, values: Record<string, unknown>) {
  const { error } = await admin.from("profiles").update(values).eq("id", id);
  if (error) throw error;
}

type Bucket = ReturnType<SupabaseClient["storage"]["from"]>;

const PAGE = 1000;

/**
 * Every object name under `prefix`, a page at a time — list() stops at its
 * limit, so a single call would leave the rest behind. Entries without an id
 * are folders (Storage has no real ones): walked into, a few levels at most.
 * Everything is listed before anything is removed, so the offsets hold.
 */
async function listObjects(bucket: Bucket, prefix: string, depth = 0): Promise<string[]> {
  const names: string[] = [];
  const folders: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    for (const item of data ?? []) {
      if (item.id) names.push(`${prefix}/${item.name}`);
      else folders.push(`${prefix}/${item.name}`);
    }
    if (!data || data.length < PAGE) break;
  }
  if (depth < 3) {
    for (const folder of folders) names.push(...(await listObjects(bucket, folder, depth + 1)));
  }
  return names;
}

/** Wipe and reseed the demo workspace (0025), and clear its uploaded receipts. */
export async function resetDemoData(ids?: { demoId: string; teamIds: string[] }) {
  const admin = createAdminClient();
  const { demoId, teamIds } = ids ?? (await ensureDemoUsers());

  const { error } = await admin.rpc("reset_demo_workspace", { p_demo: demoId, p_team: teamIds });
  if (error) throw error;

  // Receipts uploaded by visitors live under demo/ in Storage (the reseed
  // dropped their rows; SQL can't empty Storage). The demo's 50-file cap
  // (0027 receipt_room) counts these, so a cleanup that stops early shows up.
  try {
    const bucket = admin.storage.from("receipts");
    const paths = await listObjects(bucket, "demo");
    for (let i = 0; i < paths.length; i += PAGE) {
      const { error: removeError } = await bucket.remove(paths.slice(i, i + PAGE));
      if (removeError) throw removeError;
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e);
    throw new Error(`The demo data was reset, but its uploaded receipts weren't cleared: ${reason}`);
  }
  return { demoId, teamIds };
}

/**
 * A repair is ~10 Auth admin calls (a bcrypt hash among them) and the sign-in
 * form is public, so repairs are spaced out. In this server instance's memory:
 * serverless instances don't share it, which only loosens the bound.
 */
const HEAL_EVERY_MS = 2 * 60_000;
let lastHeal = 0;

/**
 * Repair the demo login after the public password failed to open it — a
 * visitor may have changed the password or email through the Auth API. At
 * most once per HEAL_EVERY_MS; true when a repair ran and the caller should
 * try signing in again. Never throws — a failure is logged.
 */
export async function healDemoLogin(): Promise<boolean> {
  const now = Date.now();
  if (now - lastHeal < HEAL_EVERY_MS) return false;
  lastHeal = now;
  try {
    await ensureDemoUsers();
    return true;
  } catch (e) {
    console.error("[demo] repairing the demo login failed:", e);
    return false;
  }
}

/**
 * Runs after a successful demo sign-in: reseed when the data has been played
 * with for longer than DEMO_STALE_HOURS. The stamp is claimed with one
 * conditional UPDATE first, so of several sign-ins at once exactly one runs
 * the reset. Never blocks the sign-in — a failure is logged, the stamp is put
 * back so the next sign-in tries again, and the visitor still gets in.
 */
export async function refreshDemoIfStale() {
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("workspaces").select("demo_reset_at").eq("id", "demo").maybeSingle<{
      demo_reset_at: string | null;
    }>();
    if (!data) return;

    const now = new Date();
    const cutoff = new Date(now.getTime() - DEMO_STALE_HOURS * 3_600_000).toISOString();
    const last = data.demo_reset_at ? Date.parse(data.demo_reset_at) : Number.NaN;
    // Never reset, unreadable (NaN, or Postgres' ±infinity), reset too long
    // ago, or stamped in the future (a bad clock, or a write that set it
    // ahead to dodge the reseed) — all stale.
    const stale = !Number.isFinite(last) || last < Date.parse(cutoff) || last > now.getTime();
    if (!stale) return;

    // Claim it only if the stamp is still the one judged stale above, so
    // whatever made it stale (a value no clock agrees with included) is
    // exactly what's replaced — and of several sign-ins, one wins.
    const claim = now.toISOString();
    const update = admin.from("workspaces").update({ demo_reset_at: claim }).eq("id", "demo");
    const { data: claimed, error } = await (
      data.demo_reset_at === null ? update.is("demo_reset_at", null) : update.eq("demo_reset_at", data.demo_reset_at)
    ).select("id");
    if (error) throw error;
    if (!claimed?.length) return; // another sign-in got there first

    try {
      await resetDemoData(await ensureDemoUsers({ repairLogin: false }));
    } catch (e) {
      // reset_demo_workspace stamps its own success; only undo our claim.
      await admin
        .from("workspaces")
        .update({ demo_reset_at: data.demo_reset_at })
        .eq("id", "demo")
        .eq("demo_reset_at", claim);
      throw e;
    }
  } catch (e) {
    console.error("[demo] refreshing stale demo data failed:", e);
  }
}
