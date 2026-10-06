import type { Metadata } from "next";
import type { User } from "@supabase/supabase-js";
import { requireModule, type Session } from "@/lib/admin/auth";
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_STALE_HOURS } from "@/lib/admin/demo";
import { addDays, fromLocalInput } from "@/lib/admin/format";
import { isDemo, isSuperAdmin } from "@/lib/admin/modules";
import type { ActivityEntry, TeamMember } from "@/lib/admin/types";
import { createAdminClient, serviceRoleReady } from "@/lib/supabase/admin";
import { Icon } from "@/components/admin/icons";
import { RouteTabs, type RouteTab } from "@/components/admin/Tabs";
import { Notice, PageHead } from "@/components/admin/ui";
import ActivityLog from "./ActivityLog";
import { SYSTEM_ACTOR, parseActivityFilters, type ActivityFilters } from "./activity";
import DemoPanel, { type DemoAccount } from "./DemoPanel";
import TeamTable, { type TeamRow } from "./TeamTable";

export const metadata: Metadata = { title: "Team & Users" };

type Tab = "users" | "activity" | "demo";

const PROFILE_COLUMNS = "id, email, full_name, role, permissions, title, is_active, created_at";
const ACTIVITY_COLUMNS = "id, actor_id, action, entity_type, entity_id, entity_label, summary, changes, created_at";
const ROLE_ORDER = { super_admin: 0, admin: 1, member: 2, viewer: 3 } as const;

/**
 * Team & Users. The super admin manages accounts here; the demo admin gets
 * the same screens read-only, over the fictional teammates. Profiles are read
 * with the caller's session (RLS keeps each workspace to itself) — the
 * service role is only for what Auth alone knows: last sign-in, the demo reset.
 */
export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    user?: string;
    actor?: string;
    entity?: string;
    from?: string;
    to?: string;
    show?: string;
  }>;
}) {
  const { supabase, profile } = await requireModule("team");
  const params = await searchParams;
  const superAdmin = isSuperAdmin(profile);
  const demo = isDemo(profile);
  const ready = superAdmin && serviceRoleReady();
  const tab: Tab =
    params.tab === "activity" ? "activity" : params.tab === "demo" && superAdmin ? "demo" : "users";

  const { data: profiles } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .returns<(TeamMember & { created_at: string })[]>();
  const people = profiles ?? [];

  const tabs: RouteTab[] = [
    {
      href: "/admin/team",
      label: "Users",
      count: people.length,
      icon: <Icon.users size={13} />,
      param: { key: "tab", value: "users", isDefault: true },
    },
    {
      href: "/admin/team?tab=activity",
      label: "Activity",
      icon: <Icon.history size={13} />,
      param: { key: "tab", value: "activity" },
    },
    ...(superAdmin
      ? [
          {
            href: "/admin/team?tab=demo",
            label: "Demo",
            icon: <Icon.eye size={13} />,
            param: { key: "tab", value: "demo" },
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHead
        eyebrow={demo ? "Demo · Admin" : "Admin"}
        title="Team & Users"
        hint="Who can sign in, and what each person can open. Admins get everything except this page; members get the modules you tick."
      />

      {superAdmin && !ready && (
        <div className="mb-4">
          <Notice title="Add the service-role key to manage accounts">
            Creating, banning and deleting accounts goes through Supabase&apos;s admin API, which needs{" "}
            <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span> in the server environment (Project Settings →
            API → service_role). Until it&apos;s set you can see the team but not change it.
          </Notice>
        </div>
      )}
      {demo && (
        <div className="mb-4">
          <Notice tone="info" title="A look at Team & Users">
            These are fictional teammates in the demo workspace. Open one to see how access is set — saving is
            disabled in the demo.
          </Notice>
        </div>
      )}

      <RouteTabs tabs={tabs} className="mb-4" />

      {tab === "users" && <UsersTab people={people} meId={profile.id} demo={demo} ready={ready} openId={params.user} />}
      {tab === "activity" && (
        <ActivityTab supabase={supabase} people={people} filters={parseActivityFilters(params)} />
      )}
      {tab === "demo" && <DemoTab ready={ready} />}
    </>
  );
}

/* ─────────────────────────────── tabs ──────────────────────────────────── */

async function UsersTab({
  people,
  meId,
  demo,
  ready,
  openId,
}: {
  people: (TeamMember & { created_at: string })[];
  meId: string;
  demo: boolean;
  ready: boolean;
  openId?: string;
}) {
  // Sign-in times live in Auth, not in profiles. Without them the table
  // still works — the column just reads "—".
  let auth = new Map<string, User>();
  let authError: string | null = null;
  if (ready) {
    try {
      auth = await loadAuthUsers();
    } catch (e) {
      authError = e instanceof Error ? e.message : "Supabase Auth didn't answer.";
    }
  }

  const rows: TeamRow[] = people
    .map((p) => ({ ...p, last_sign_in_at: auth.get(p.id)?.last_sign_in_at ?? null }))
    .sort(
      (a, b) =>
        Number(b.is_active) - Number(a.is_active) ||
        ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
        (a.full_name || a.email).localeCompare(b.full_name || b.email),
    );

  return (
    <>
      {authError && (
        <div className="mb-4">
          <Notice tone="danger" title="Couldn't read sign-in times from Supabase Auth">
            {authError}
          </Notice>
        </div>
      )}
      <TeamTable
        members={rows}
        meId={meId}
        workspace={demo ? "demo" : "live"}
        locked={demo ? "Disabled in the demo" : ready ? null : "Needs the service-role key"}
        showSignIns={ready && !authError}
        openId={openId}
      />
    </>
  );
}

async function ActivityTab({
  supabase,
  people,
  filters,
}: {
  supabase: Session["supabase"];
  people: TeamMember[];
  filters: ActivityFilters;
}) {
  // RLS: only Team users read the log, and only their own workspace's. The
  // filters run here, before the limit, so older rows are reachable.
  let query = supabase.from("activity_log").select(ACTIVITY_COLUMNS, { count: "exact" });
  if (filters.actor === SYSTEM_ACTOR) query = query.is("actor_id", null);
  else if (filters.actor) query = query.eq("actor_id", filters.actor);
  if (filters.entity) query = query.eq("entity_type", filters.entity);
  // Colombo days, inclusive of the last one.
  const since = fromLocalInput(filters.from);
  const until = filters.to ? fromLocalInput(addDays(filters.to, 1)) : null;
  if (since) query = query.gte("created_at", since);
  if (until) query = query.lt("created_at", until);

  const { data, count } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(filters.limit)
    .returns<ActivityEntry[]>();
  const entries = data ?? [];
  return <ActivityLog entries={entries} total={count ?? entries.length} people={people} filters={filters} />;
}

async function DemoTab({ ready }: { ready: boolean }) {
  let resetAt: string | null = null;
  let accounts: DemoAccount[] = [];
  if (ready) {
    // The super admin's session can't see the demo workspace — that's the
    // fence working — so its status is read with the service role.
    const admin = createAdminClient();
    const [{ data: ws }, { data: rows }] = await Promise.all([
      admin.from("workspaces").select("demo_reset_at").eq("id", "demo").maybeSingle<{ demo_reset_at: string | null }>(),
      admin
        .from("profiles")
        .select("id, email, full_name, title, role")
        .eq("workspace", "demo")
        .order("role", { ascending: true })
        .returns<DemoAccount[]>(),
    ]);
    resetAt = ws?.demo_reset_at ?? null;
    accounts = rows ?? [];
  }

  return (
    <DemoPanel
      email={DEMO_EMAIL}
      password={DEMO_PASSWORD}
      resetAt={resetAt}
      accounts={accounts}
      ready={ready}
      staleHours={DEMO_STALE_HOURS}
    />
  );
}

/* ─────────────────────────────── data ──────────────────────────────────── */

async function loadAuthUsers() {
  const admin = createAdminClient();
  const users = new Map<string, User>();
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) users.set(u.id, u);
    if (data.users.length < 1000) break;
  }
  return users;
}
