/** Row shapes for the admin tables. Mirrors supabase/migrations/*.sql. */

export type Role = "super_admin" | "admin" | "member" | "viewer";

export type Workspace = "live" | "demo";

/** Grantable module keys — mirrors profiles_permissions_check in 0007. */
export type ModuleKey =
  | "dashboard"
  | "inquiries"
  | "email"
  | "crm"
  | "clients"
  | "invoices"
  | "finance"
  | "reports"
  | "calendar"
  | "todos"
  | "workload";

/** Everything canAccess() understands: the grantable modules plus Team & Users. */
export type AccessKey = ModuleKey | "team";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  permissions: ModuleKey[];
  workspace: Workspace;
  is_active: boolean;
  title: string | null;
  created_at: string;
};

/** What the client Shell knows about the signed-in person. */
export type ShellProfile = Omit<Profile, "created_at">;

/** The slice of a profile other screens need to show and tag people. */
export type TeamMember = Pick<Profile, "id" | "email" | "full_name" | "role" | "permissions" | "title" | "is_active">;

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  member: "Member",
  viewer: "No access",
};

export type InquiryStatus = "new" | "read" | "converted" | "archived";

export type Inquiry = {
  id: string;
  name: string;
  business: string | null;
  contact: string;
  focus: string | null;
  message: string | null;
  source: string;
  page: string | null;
  status: InquiryStatus;
  converted_lead_id: string | null;
  notes: string | null;
  created_at: string;
};

export type StageTone = "terra" | "cream" | "success" | "warn" | "muted";

export type Stage = {
  id: string;
  name: string;
  slug: string | null;
  position: number;
  tone: StageTone;
  is_protected: boolean;
  is_won: boolean;
  is_lost: boolean;
};

export type Score = "HOT" | "WARM" | "COLD";

export type Lead = {
  id: string;
  stage_id: string;
  owner_id?: string | null;
  client_id?: string | null;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  value: number;
  currency: string;
  score: Score;
  source: string;
  notes: string | null;
  next_action: string | null;
  position: number;
  inquiry_id: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadActivity = {
  id: string;
  lead_id: string;
  kind: "note" | "stage" | "created" | "call" | "message" | "meeting";
  body: string;
  created_at: string;
};

export type FinanceKind = "income" | "expense";

export type ApprovalStatus = "approved" | "pending" | "rejected";

export type FinanceEntry = {
  id: string;
  kind: FinanceKind;
  approval_status?: ApprovalStatus;
  invoice_id?: string | null;
  invoice_payment_id?: string | null;
  entry_date: string;
  description: string;
  category: string;
  amount: number;
  signed_amount: number;
  currency: string;
  method: string | null;
  reference: string | null;
  created_at: string;
};

export type FinanceTotals = {
  income: number;
  expense: number;
  profit: number;
  entries: number;
};

export type EventKind = "task" | "meeting" | "follow_up" | "payment" | "other";

export type CalendarEvent = {
  id: string;
  created_by?: string | null;
  location?: string | null;
  meeting_url?: string | null;
  client_id?: string | null;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  kind: EventKind;
  done: boolean;
  lead_id: string | null;
  inquiry_id: string | null;
};

/** Categories offered in the expense form; free text is still accepted. */
export const EXPENSE_CATEGORIES = [
  "Software & subscriptions",
  "Contractors",
  "Salaries",
  "Marketing & ads",
  "Hosting & infrastructure",
  "Equipment",
  "Office & utilities",
  "Travel",
  "Bank & fees",
  "Taxes",
  "General",
] as const;

export const INCOME_CATEGORIES = [
  "Client project",
  "Retainer",
  "Deposit",
  "Consulting",
  "Support & maintenance",
  "Other income",
] as const;

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  task: "Task",
  meeting: "Meeting",
  follow_up: "Follow-up",
  payment: "Payment",
  other: "Other",
};

/* ──────────────────────────── collaboration ──────────────────────────── */

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  actor_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  deliver_at: string;
  read_at: string | null;
  created_at: string;
};

export type ActivityEntry = {
  id: number;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  summary: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  created_at: string;
};

/** What a calendar cell can hold — events plus everything else that has a date. */
export type CalendarItemKind = "event" | "todo" | "time_off" | "invoice_due" | "quote_expiry" | "recurring_run";

export type CalendarItem = {
  /** `${kind}:${id}` — unique across kinds. */
  key: string;
  kind: CalendarItemKind;
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  /** Event kind (meeting, task…) or to-do priority, time-off type — drives the chip tone. */
  tone: string;
  done: boolean;
  /** People shown as avatars on the chip (attendees, assignees, the person on leave). */
  people: string[];
  created_by: string | null;
  /** Approval state for time off; null elsewhere. */
  status: string | null;
  href: string | null;
  /** Can the viewer open the edit modal? Read-only kinds are false. */
  editable: boolean;
};

export type SearchResult = {
  entity_type: "client" | "lead" | "invoice" | "quote" | "todo" | "event" | "inquiry";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};
