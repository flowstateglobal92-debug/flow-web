/**
 * The notification columns every reader selects — the layout, the full list
 * and the provider's poll. Plain module (no "use client") so server pages can
 * import the string itself rather than a client reference.
 */
export const NOTIFICATION_COLUMNS =
  "id, type, title, body, link, actor_id, entity_type, entity_id, deliver_at, read_at, created_at";
