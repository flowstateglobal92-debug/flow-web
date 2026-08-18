/** Row shapes for the admin tables. Mirrors supabase/migrations/*.sql. */

export type Role = "admin" | "viewer";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  created_at: string;
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

export type FinanceEntry = {
  id: string;
  kind: FinanceKind;
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
