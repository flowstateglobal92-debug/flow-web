/**
 * Team & Users rules shared by the web admin (src/app/admin/actions/team.ts)
 * and the desktop app's team function (supabase/functions/team), so both
 * accept and refuse exactly the same input with the same sentences.
 *
 * Pure: no environment, no framework. The Edge Function gets a generated copy —
 * edit this file, then run `node scripts/sync-edge-shared.mjs`.
 */

/** "Never" for a ban, as GoTrue spells it — about a hundred years. */
export const BAN_FOREVER = "876000h";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An Auth error meaning the address is taken (usually someone who signed up on their own). */
export const EMAIL_TAKEN = /already (been )?registered|already exists/i;
export const EMAIL_TAKEN_MESSAGE = "That email already has an account — find it in the list and edit its access.";

/** The account form as it was filled in. */
export type AccountFields = {
  full_name: string;
  email: string;
  title: string;
  password: string;
  role: string;
  permissions: string[];
};

export type Account<M extends string> = {
  full_name: string;
  email: string;
  title: string | null;
  password: string;
  role: "admin" | "member";
  permissions: M[];
};

/**
 * Validate and normalise the account form. Throws an Error whose message is
 * the sentence to show.
 */
export function checkAccount<M extends string>(
  fields: AccountFields,
  {
    passwordRequired,
    grantable,
    demoEmail,
  }: { passwordRequired: boolean; grantable: readonly M[]; demoEmail: string },
): Account<M> {
  const full_name = fields.full_name.trim();
  const email = fields.email.trim().toLowerCase();
  // Passwords are taken exactly as typed — spaces included.
  const password = fields.password;
  // Anything but "admin" is a member: the form can never ask for super_admin.
  const role: "admin" | "member" = fields.role.trim() === "admin" ? "admin" : "member";
  const permissions = role === "member" ? grantable.filter((k) => fields.permissions.includes(k)) : [];

  if (!full_name) throw new Error("Add their name.");
  if (!EMAIL.test(email)) throw new Error("That email address doesn't look right.");
  if (email === demoEmail) throw new Error("That address belongs to the demo account.");
  if (passwordRequired && !password) throw new Error("Set a password for them.");
  if (password && password.length < 8) throw new Error("Use at least 8 characters for the password.");

  return { full_name, email, title: fields.title.trim() || null, password, role, permissions };
}

/** What the toast says once an account is made. */
export const createdMessage = (account: { full_name: string; role: string; permissions: unknown[] }) => {
  const first = account.full_name.split(/\s+/)[0];
  return account.role === "member" && account.permissions.length === 0
    ? `${first} is set up, but no modules are ticked yet.`
    : `${first} can sign in now.`;
};
