/**
 * The demo account — a sandbox for showing Flow State to prospects.
 *
 * It lives in its own workspace ('demo'); RLS fences it off from every live
 * row (0008). Sharing these credentials is the point, so they're constants.
 */
import type { ModuleKey } from "./types";

export const DEMO_EMAIL = "demo@flowstate.com";
export const DEMO_PASSWORD = "demo123";

export const DEMO_PROFILE = {
  full_name: "Alex Perera",
  title: "Managing director",
};

/** Data older than this is reseeded the next time someone signs in to the demo. */
export const DEMO_STALE_HOURS = 12;

/**
 * Fictional teammates so tagging, workload and approvals have someone to show.
 * They get random passwords and a permanent ban — nobody can sign in as them.
 * Keys are stable: the seed (0025) looks teammates up by position in p_team.
 */
export const DEMO_TEAM: {
  key: string;
  email: string;
  full_name: string;
  title: string;
  permissions: ModuleKey[];
}[] = [
  {
    key: "maya",
    email: "maya.fernando@example.com",
    full_name: "Maya Fernando",
    title: "Project lead",
    permissions: ["dashboard", "crm", "clients", "calendar", "todos", "workload"],
  },
  {
    key: "kavin",
    email: "kavin.jayasuriya@example.com",
    full_name: "Kavin Jayasuriya",
    title: "Sales",
    permissions: ["inquiries", "crm", "clients", "calendar", "todos"],
  },
  {
    key: "nadia",
    email: "nadia.rahman@example.com",
    full_name: "Nadia Rahman",
    title: "Finance",
    permissions: ["invoices", "finance", "reports", "clients", "calendar", "todos"],
  },
];
