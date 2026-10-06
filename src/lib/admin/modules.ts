/**
 * The admin's modules and the one access rule.
 *
 * `canAccess` mirrors `private.role_allows()` in supabase/migrations/0007 and
 * 0008 — RLS is the wall, this only decides what the UI offers. Keep the two
 * in step.
 */
import type { AccessKey, ModuleKey, Profile, Role, Workspace } from "./types";
import type { AdminIcon } from "@/components/admin/icons";

export type NavGroup = "Work" | "Sales" | "Money" | "Admin";

export type ModuleDef = {
  key: AccessKey;
  label: string;
  href: string;
  hint: string;
  icon: AdminIcon;
  group: NavGroup;
  /** One line shown next to the checkbox in Team & Users. */
  grantHint?: string;
};

/** Nav order. `team` is never grantable; Approvals and My account aren't modules. */
export const MODULES: ModuleDef[] = [
  { key: "dashboard", label: "Dashboard", href: "/admin", hint: "Today at a glance", icon: "dashboard", group: "Work", grantHint: "The overview page. Widgets only show modules they also have." },
  { key: "calendar", label: "Calendar", href: "/admin/calendar", hint: "Shared team calendar", icon: "calendar", group: "Work", grantHint: "Everyone's events, leave and dated to-dos." },
  { key: "todos", label: "To-dos", href: "/admin/todos", hint: "Tasks & reminders", icon: "checklist", group: "Work", grantHint: "Can be tagged on to-dos. Tagged to-dos show on Calendar." },
  { key: "workload", label: "Workload", href: "/admin/workload", hint: "Who's carrying what", icon: "scale", group: "Work", grantHint: "Per-person load, availability and ownership." },
  { key: "inquiries", label: "Inquiries", href: "/admin/inquiries", hint: "Form submissions", icon: "inbox", group: "Sales", grantHint: "Website form submissions; alerted on new ones." },
  { key: "email", label: "Email", href: "/admin/email", hint: "Inbox & sent", icon: "mail", group: "Sales", grantHint: "Reads and sends as the company mailbox." },
  { key: "crm", label: "CRM", href: "/admin/crm", hint: "Kanban pipeline", icon: "pipeline", group: "Sales", grantHint: "Leads and the pipeline board." },
  { key: "clients", label: "Clients", href: "/admin/clients", hint: "Accounts & contacts", icon: "building", group: "Sales", grantHint: "Client profiles. Invoices use it for bill-to." },
  { key: "invoices", label: "Invoices", href: "/admin/invoices", hint: "Quotes, invoices, retainers", icon: "receipt", group: "Money", grantHint: "Create, issue and record payments (payments post to Income)." },
  { key: "finance", label: "Expenses", href: "/admin/expenses", hint: "Ledger & budgets", icon: "ledger", group: "Money", grantHint: "The income/expense ledger, receipts and budgets." },
  { key: "reports", label: "Reports", href: "/admin/reports", hint: "P&L, aging, cash flow", icon: "chart", group: "Money", grantHint: "Company-wide totals, even without ledger access." },
  { key: "team", label: "Team & Users", href: "/admin/team", hint: "People & access", icon: "users", group: "Admin" },
];

/** Always available to every active user — not permissions, so not in MODULES. */
export const APPROVALS_NAV = {
  label: "Approvals",
  href: "/admin/approvals",
  hint: "Requests & sign-off",
  icon: "shield" as AdminIcon,
  group: "Admin" as NavGroup,
};

export const NAV_GROUPS: NavGroup[] = ["Work", "Sales", "Money", "Admin"];

export const GRANTABLE: ModuleKey[] = MODULES.filter((m) => m.key !== "team").map((m) => m.key as ModuleKey);

type Who = Pick<Profile, "role" | "permissions" | "workspace" | "is_active">;

/** Same rule as private.role_allows(). */
export function roleAllows(
  role: Role,
  permissions: readonly string[] | null | undefined,
  workspace: Workspace,
  active: boolean,
  key: AccessKey,
) {
  if (!active) return false;
  if (workspace === "demo" && key === "email") return false;
  if (role === "super_admin") return workspace === "live";
  if (role === "admin") return key !== "team" || workspace === "demo";
  if (role === "member") return key !== "team" && (permissions ?? []).includes(key);
  return false;
}

export function canAccess(profile: Who | null | undefined, key: AccessKey) {
  if (!profile) return false;
  return roleAllows(profile.role, profile.permissions, profile.workspace, profile.is_active, key);
}

/** super_admin / admin — approve requests, override ownership, edit settings. */
export const isApprover = (profile: Who | null | undefined) =>
  !!profile && profile.is_active && (profile.role === "super_admin" || profile.role === "admin");

/** Team & Users actions (create users, reset demo). The demo admin only gets a read-only view. */
export const isSuperAdmin = (profile: Who | null | undefined) =>
  !!profile && profile.is_active && profile.role === "super_admin" && profile.workspace === "live";

export const isDemo = (profile: Pick<Profile, "workspace"> | null | undefined) => profile?.workspace === "demo";

/** Where to land someone who can't open the page they asked for. */
export function firstAllowedHref(profile: Who | null | undefined) {
  const first = MODULES.find((m) => canAccess(profile, m.key));
  return first?.href ?? "/admin/no-access";
}

/** Is `path` (an /admin URL) one this person may open? Used to vet `?next=`. */
export function canOpenPath(profile: Who | null | undefined, path: string) {
  if (!path.startsWith("/admin")) return false;
  const always = ["/admin/account", "/admin/approvals", "/admin/notifications", "/admin/no-access", "/admin/print"];
  if (always.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`))) return true;
  const match = [...MODULES]
    .sort((a, b) => b.href.length - a.href.length)
    .find((m) => (m.href === "/admin" ? path === "/admin" || path.startsWith("/admin?") : path.startsWith(m.href)));
  return match ? canAccess(profile, match.key) : false;
}

export function moduleLabel(key: AccessKey) {
  return MODULES.find((m) => m.key === key)?.label ?? key;
}
