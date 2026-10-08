import { timingSafeEqual } from "node:crypto";
import { runJobs } from "@/lib/admin/jobs";

/**
 * POST /api/jobs/run — the scheduled work (reminders, monthly statements…),
 * see lib/admin/jobs.ts. Called hourly by netlify/functions/scheduled-jobs.mts
 * with `Authorization: Bearer <CRON_SECRET>`; anything else gets a 404, so
 * the endpoint doesn't announce itself.
 */
export const dynamic = "force-dynamic";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 24) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function POST(req: Request) {
  if (!authorized(req)) return new Response("Not found", { status: 404 });
  const report = await runJobs();
  return Response.json(report, { headers: { "cache-control": "no-store" } });
}
