import { isDay } from "@/components/admin/calendar/items";

/**
 * Team → Activity filters, as they ride in the URL
 * (/admin/team?tab=activity&actor=&entity=&from=&to=&show=). Shared by the
 * page, which runs them in the query, and ActivityLog, which writes them.
 */

/** Rows per "Show more". */
export const ACTIVITY_PAGE = 120;
/** The most one page will load, however often "Show more" is pressed. */
const ACTIVITY_MAX = 2_400;

/** The Person filter's value for entries no one made (triggers, the cron). */
export const SYSTEM_ACTOR = "system";

export type ActivityFilters = {
  /** A user id, SYSTEM_ACTOR, or null for everyone. */
  actor: string | null;
  /** An entity_type (lead, invoice, todo …), or null for every area. */
  entity: string | null;
  /** Colombo days, inclusive. */
  from: string | null;
  to: string | null;
  /** How many of the newest matching rows to load. */
  limit: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whatever arrived in the URL, reduced to filters that are safe to query with. */
export function parseActivityFilters(params: {
  actor?: string;
  entity?: string;
  from?: string;
  to?: string;
  show?: string;
}): ActivityFilters {
  const actor = params.actor === SYSTEM_ACTOR || (params.actor && UUID.test(params.actor)) ? params.actor : null;
  const entity = params.entity && /^[a-z_]{1,40}$/.test(params.entity) ? params.entity : null;
  let from = isDay(params.from) ? params.from : null;
  let to = isDay(params.to) ? params.to : null;
  if (from && to && from > to) [from, to] = [to, from];
  const show = Number.parseInt(params.show ?? "", 10);
  const limit = Number.isFinite(show) ? Math.min(Math.max(show, ACTIVITY_PAGE), ACTIVITY_MAX) : ACTIVITY_PAGE;
  return { actor, entity, from, to, limit };
}
