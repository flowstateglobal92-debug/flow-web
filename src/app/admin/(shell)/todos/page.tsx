import type { Metadata } from "next";
import { requireModule } from "@/lib/admin/auth";
import { loadCalendarItems } from "@/lib/admin/calendar-feed";
import { addDays, fromLocalInput, todayISO } from "@/lib/admin/format";
import { canAccess, isApprover } from "@/lib/admin/modules";
import { loadTeam } from "@/lib/admin/team";
import { PageHead } from "@/components/admin/ui";
import { gridRange } from "@/components/admin/calendar/items";
import { TODO_SELECT, toTodo, type LeaveSpan, type LinkOption, type TodoRow } from "./model";
import TodosScreen from "./TodosScreen";

export const metadata: Metadata = { title: "To-dos" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Named = { id: string; name: string; company: string | null };

/**
 * Tasks and reminders. Deep links: ?open=<id> opens a to-do, ?new=1 the new
 * to-do drawer, ?assignee=<user> filters to one person (Workload links here),
 * ?view=board|calendar picks the view.
 */
export default async function TodosPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string; new?: string; assignee?: string; view?: string }>;
}) {
  const { supabase, profile } = await requireModule("todos");
  const params = await searchParams;
  const openId = params.open && UUID.test(params.open) ? params.open : null;
  const assignee = params.assignee && UUID.test(params.assignee) ? params.assignee : null;

  const today = todayISO();
  const month = today.slice(0, 7);
  const range = gridRange(month);
  const doneSince = fromLocalInput(addDays(today, -30)) as string;

  const [open, done, linked, team, leads, clients, invoices, leave, calendar] = await Promise.all([
    supabase
      .from("todos")
      .select(TODO_SELECT)
      .neq("status", "done")
      .order("position", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(600)
      .returns<TodoRow[]>(),
    supabase
      .from("todos")
      .select(TODO_SELECT)
      .eq("status", "done")
      .gte("completed_at", doneSince)
      .order("completed_at", { ascending: false })
      .limit(80)
      .returns<TodoRow[]>(),
    // A deep link may point at something older than the done window.
    openId
      ? supabase.from("todos").select(TODO_SELECT).eq("id", openId).maybeSingle<TodoRow>()
      : Promise.resolve({ data: null }),
    loadTeam(supabase),
    canAccess(profile, "crm")
      ? supabase.from("leads").select("id, name, company").order("updated_at", { ascending: false }).limit(400).returns<Named[]>()
      : Promise.resolve({ data: [] as Named[] }),
    supabase
      .from("clients")
      .select("id, name, company")
      .neq("status", "archived")
      .order("name", { ascending: true })
      .limit(400)
      .returns<Named[]>(),
    canAccess(profile, "invoices")
      ? supabase
          .from("invoices")
          .select("id, kind, number, bill_to_name, bill_to_company")
          .neq("status", "void")
          .order("created_at", { ascending: false })
          .limit(300)
          .returns<{ id: string; kind: string; number: string | null; bill_to_name: string; bill_to_company: string | null }[]>()
      : Promise.resolve({ data: [] }),
    // Leave from yesterday to six months out, for the "on leave that day" warning.
    supabase
      .from("time_off")
      .select("user_id, type, starts_on, ends_on, half_day, status")
      .in("status", ["approved", "pending"])
      .gte("ends_on", addDays(today, -1))
      .lte("starts_on", addDays(today, 180))
      .limit(500)
      .returns<LeaveSpan[]>(),
    loadCalendarItems(supabase, profile, range.from, range.to, { only: ["todo"] }),
  ]);

  // A missing table (0020 not applied yet) reads as an empty list with a note.
  const missing = !!open.error;
  const rows = [...(open.data ?? []), ...(done.data ?? [])];
  if (linked.data && !rows.some((r) => r.id === linked.data!.id)) rows.push(linked.data);
  const todos = rows.map(toTodo);

  const label = (n: Named) => (n.company && n.company !== n.name ? `${n.company} · ${n.name}` : n.company || n.name);
  const links = {
    leads: (leads.data ?? []).map((l): LinkOption => ({ id: l.id, label: label(l) })),
    clients: (clients.data ?? []).map((c): LinkOption => ({ id: c.id, label: label(c) })),
    invoices: (invoices.data ?? []).map(
      (i): LinkOption => ({
        id: i.id,
        label: `${i.number ?? (i.kind === "quote" ? "Draft quote" : "Draft")} · ${i.bill_to_company || i.bill_to_name || "Client"}`,
      }),
    ),
  };

  return (
    <>
      <PageHead
        eyebrow="Work"
        title="To-dos"
        hint="Tasks and reminders for the team. Tag someone with @ and it lands on their calendar — today, if you don't give it a date."
      />
      <TodosScreen
        todos={todos}
        team={team}
        me={profile.id}
        canAdmin={isApprover(profile)}
        links={links}
        leave={leave.data ?? []}
        calendar={{ items: calendar, month }}
        openId={openId}
        openNew={params.new === "1"}
        assignee={assignee}
        initialView={params.view === "board" || params.view === "calendar" ? params.view : "list"}
        missing={missing}
      />
    </>
  );
}
