// Every hour, ask the site to do its scheduled work (payment reminders,
// monthly statements…): POST /api/jobs/run with CRON_SECRET. The work itself
// lives in the Next app (src/lib/admin/jobs.ts), so it's built and deployed
// with everything else; this file is only the clock.
//
// Netlify: set CRON_SECRET (a long random string, 24+ characters) in the
// site's environment variables. Scheduled functions run on published deploys.
const run = async () => {
  const secret = process.env.CRON_SECRET;
  const site = process.env.URL;
  if (!secret || !site) {
    console.log("scheduled-jobs: CRON_SECRET or URL missing — skipped");
    return new Response("skipped", { status: 200 });
  }
  const res = await fetch(`${site}/api/jobs/run`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  const text = await res.text();
  console.log(`scheduled-jobs: ${res.status} ${text.slice(0, 500)}`);
  return new Response(null, { status: 204 });
};

export default run;

export const config = { schedule: "@hourly" };
