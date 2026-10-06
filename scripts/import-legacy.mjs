#!/usr/bin/env node
/**
 * Copy the business data from the old Supabase project into the new one.
 *
 *   npm run import:legacy -- --dry-run     read the old project and report counts
 *   npm run import:legacy                  copy for real (safe to re-run)
 *
 * Needs, in .env.local:
 *   OLD_SUPABASE_URL, OLD_SUPABASE_SERVICE_ROLE_KEY     the project you're leaving
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  the new one (all migrations run,
 *                                                        super admin already created)
 *
 * Reads pipeline_stages, inquiries, leads, lead_activities, finance_entries,
 * calendar_events and email_states through the old project's REST API, then
 * hands everything to `import_legacy_data(payload)` (migration 0026), which
 * writes it into the live workspace in ONE transaction with notifications and
 * the activity log switched off. Rows keep their ids and conflicts are
 * skipped, so running it twice copies nothing twice.
 *
 * People: old user ids are mapped to new accounts by email. Anything authored
 * by someone who has no account in the new project is credited to the super
 * admin.
 */
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry-run");
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

const need = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} in .env.local`);
    process.exit(1);
  }
  return v;
};

const oldDb = createClient(need("OLD_SUPABASE_URL"), need("OLD_SUPABASE_SERVICE_ROLE_KEY"), opts);
const newDb = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), opts);

if (process.env.OLD_SUPABASE_URL === process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error("OLD_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_URL are the same project — nothing to copy.");
  process.exit(1);
}

/**
 * Every row of a table, 1000 at a time. A table the old project never had reads as empty.
 * Paged on `order` then the primary key: rows sharing a created_at (one bulk insert)
 * have no stable order on their own, and a page boundary could skip some of them.
 */
async function readAll(table, order = "created_at", pk = "id") {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await oldDb
      .from(table)
      .select("*")
      .order(order, { ascending: true })
      .order(pk, { ascending: true })
      .range(from, from + 999);
    if (error) {
      if (/does not exist|Could not find/i.test(error.message)) return rows;
      throw new Error(`${table}: ${error.message}`);
    }
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

const tables = {
  stages: await readAll("pipeline_stages", "position"),
  inquiries: await readAll("inquiries"),
  leads: await readAll("leads"),
  lead_activities: await readAll("lead_activities"),
  finance_entries: await readAll("finance_entries"),
  calendar_events: await readAll("calendar_events"),
  email_states: await readAll("email_states", "created_at", "email_id"),
};

// ── people: old auth ids → new accounts, by email
const { data: oldPeople, error: oldPeopleError } = await oldDb.from("profiles").select("id, email");
if (oldPeopleError) throw new Error(`old profiles: ${oldPeopleError.message}`);
const { data: newPeople, error: newPeopleError } = await newDb
  .from("profiles")
  .select("id, email, role, workspace, is_active");
if (newPeopleError) throw new Error(`new profiles: ${newPeopleError.message} — have all migrations been run?`);

const superAdmin = newPeople.find((p) => p.role === "super_admin" && p.workspace === "live" && p.is_active);
if (!superAdmin) {
  console.error("The new project has no super admin yet. Create your account, then run npm run admin:promote.");
  process.exit(1);
}

const byEmail = new Map(newPeople.filter((p) => p.workspace === "live").map((p) => [p.email.toLowerCase(), p.id]));
const userMap = {};
for (const p of oldPeople ?? []) {
  userMap[p.id] = byEmail.get((p.email ?? "").toLowerCase()) ?? superAdmin.id;
}

console.log(`Old project → ${DRY ? "(dry run) " : ""}new project`);
for (const [name, rows] of Object.entries(tables)) console.log(`  ${name.padEnd(16)} ${rows.length}`);
console.log(`  people mapped    ${Object.keys(userMap).length} (fallback: ${superAdmin.email})`);

if (DRY) {
  console.log("\nDry run — nothing written. Run without --dry-run to copy.");
  process.exit(0);
}

const { data: result, error } = await newDb.rpc("import_legacy_data", {
  payload: { ...tables, user_map: userMap, fallback_user: superAdmin.id },
});

if (error) {
  console.error(`Import failed, nothing was written: ${error.message}`);
  process.exit(1);
}

console.log("\nCopied (new rows; existing ones were left alone):");
for (const [name, count] of Object.entries(result ?? {})) console.log(`  ${name.padEnd(16)} ${count}`);
