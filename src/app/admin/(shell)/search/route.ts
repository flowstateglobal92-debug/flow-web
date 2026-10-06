import type { NextRequest } from "next/server";
import { authorizeUser } from "@/lib/admin/auth";
import type { SearchResult } from "@/lib/admin/types";

/** Per-user, per-keystroke — never cache. */
export const dynamic = "force-dynamic";

const json = (body: SearchResult[]) => Response.json(body, { headers: { "Cache-Control": "private, no-store" } });

const TYPES = new Set<SearchResult["entity_type"]>(["client", "lead", "invoice", "quote", "todo", "event", "inquiry"]);

/**
 * GET /admin/search?q= → SearchResult[] for the ⌘K palette.
 *
 * search_everything (0024) is security invoker, so RLS decides what comes
 * back — a CRM-only member never sees an invoice. A missing RPC (migration not
 * run yet) or any database error answers with an empty list; the palette's
 * pages and quick actions still work.
 */
export async function GET(request: NextRequest) {
  let session;
  try {
    session = await authorizeUser();
  } catch {
    return Response.json([], { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return json([]);

  const { data, error } = await session.supabase.rpc("search_everything", { q, per_type: 5 });
  if (error || !Array.isArray(data)) return json([]);

  // Only well-formed rows that point inside the admin.
  const results: SearchResult[] = (data as SearchResult[])
    .filter((r) => r && TYPES.has(r.entity_type) && typeof r.href === "string" && /^\/admin(\/|\?|$)/.test(r.href))
    .map((r) => ({
      entity_type: r.entity_type,
      id: String(r.id),
      title: String(r.title ?? ""),
      subtitle: r.subtitle ?? null,
      href: r.href,
    }));
  return json(results);
}
