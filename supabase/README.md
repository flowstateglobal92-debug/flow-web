# Flow State — Supabase backend

Twenty-nine migrations, one per feature (0027 hardens the ones before it,
0028 is a one-off promotion, 0029 is what the desktop app syncs through). On
a new project you run every one of them, in order, once. The schema
is the security model: row-level security, a few guard triggers and a
handful of RPCs decide who sees and changes what, so the app never needs the
service-role key for everyday work.

## Fresh project runbook

1. **Create the project** in a nearby region (Mumbai or Singapore).
   - **Authentication → Sign In / Providers → Email:** turn off **Allow new users
     to sign up**. Accounts are only made from Team & Users (and the demo
     reset), which use the admin API and don't need signups.
   - **Password policy** must accept `demo123`, the shared demo password:
     minimum length 7 or less, no required character classes, and **leaked
     password protection off**. Team accounts still need 8+ characters (the
     app checks that).
   - **Optional — Database → Extensions → `pg_cron`.** With it, recurring
     invoices generate every morning and the demo resets every night. Without
     it, nothing breaks: the invoice pages catch up on load, and the demo
     reseeds when someone signs in to stale data.
2. **Run `0001` → `0029` in order** — SQL editor (paste each file, Run), or
   `supabase link` + `supabase db push`. Every file is idempotent.
   - 0017 creates the private `receipts` bucket and its storage policies. If
     it prints *"Receipts bucket created, but its storage policies could not
     be…"*, create the three `receipts: finance …` policies from the bottom of
     `0017_receipts_budgets.sql` in Storage → Policies.
   - 0027 narrows that bucket to listed image types and PDF (no SVG) and adds
     a per-entry / demo cap to the upload policy. If it warns that the policy
     *"could not be replaced"*, copy `receipts: finance uploads` from the
     bottom of `0027_security_hardening.sql` into Storage → Policies.
   - 0029 creates the private `mail-outbox` bucket the desktop app sends
     attachments through. If it warns that the bucket's policies *"could not
     be"* created, add the three `mail outbox: own …` policies from the bottom
     of `0029_desktop_sync.sql` in Storage → Policies.
   - Enabled pg_cron only after running the migrations? Schedule the jobs once:
     ```sql
     select cron.schedule('flowstate-recurring',  '30 2 * * *',  'select private.run_recurring_all()');  -- 08:00 Colombo
     select cron.schedule('flowstate-demo-reset', '30 21 * * *', 'select private.reset_demo_data()');    -- 03:00 Colombo
     ```
3. **Environment** — in `.env.local` (see `.env.example`):
   ```
   NEXT_PUBLIC_SUPABASE_URL=…        # new project
   NEXT_PUBLIC_SUPABASE_ANON_KEY=…
   SUPABASE_SERVICE_ROLE_KEY=…       # server only: Team & Users, demo, scripts
   OLD_SUPABASE_URL=…                # temporary, for the import
   OLD_SUPABASE_SERVICE_ROLE_KEY=…   # temporary, for the import
   ```
   plus the existing `RESEND_*` / `EMAIL_*` mailbox settings.
4. **Your account** — Authentication → Users → **Add user**, "Auto confirm"
   ticked. The first account on a fresh project becomes the super admin by
   itself; if it didn't (you made someone else first), run
   `npm run admin:promote -- you@flowstate.lk`.
5. **Copy the old data** — `npm run import:legacy -- --dry-run` prints what it
   would copy from the old project; check the counts, then
   `npm run import:legacy`. One transaction, everything into the live
   workspace, no notifications or activity lines; old authors are matched by
   email and anyone without an account here is credited to you. Safe to run
   twice — the second run copies nothing.
6. **Demo** — sign in, **Team → Demo → Create demo account**. That creates
   `demo@flowstate.com` / `demo123`, three fictional (banned) teammates, and
   seeds the demo workspace.
7. **Netlify** — set the same `NEXT_PUBLIC_SUPABASE_*` values and
   `SUPABASE_SERVICE_ROLE_KEY` (as a secret, runtime-only variable), deploy,
   then delete `OLD_*` from `.env.local`.

### Re-running migrations on an existing project

**Never re-run 0001–0006 on their own after 0007.** They predate teams: 0001
would put back the single-admin `is_admin()` and the old "admin manages all"
policies that 0007 dropped. If something needs re-applying, run the whole
sequence 0001 → 0029 in order — every file is idempotent, and that is how the
test harness checks them (it applies the full set twice).

## Security model

- **Roles** (`profiles.role`): `super_admin` (everything, including Team &
  Users), `admin` (everything else, and approves), `member` (only the modules
  ticked in `profiles.permissions`), `viewer` (nothing — the default for any
  account not made through Team). `public.can_access(module)` is the one rule,
  mirrored in TypeScript by `canAccess`; RLS policies call it.
- **Workspace fence** — every business table has `workspace` (`live` or
  `demo`) and one restrictive policy, `workspace fence`, ANDed with every other
  policy: you only ever see rows of your own workspace, and only while your
  account is active. The demo login lives in `demo` and can't reach a live row.
  Link guards stop a row pointing across the fence.
- **Guards** — invoker triggers hold API callers (`authenticated` / `anon`) to
  the rules: stamped creators, invoice life cycle, approval status, leave
  status, owners with module access. Trusted paths (definer RPCs, the seed,
  the import, the service role) pass.
- **`private` schema** — trigger helpers, notifications and the activity log.
  Not exposed by the API, no grants; every public RPC revokes `anon`/`PUBLIC`
  and grants `authenticated` explicitly. Aggregate RPCs (reports, workload)
  are `security definer`, check the module themselves and filter to the
  caller's workspace.
- **Service role** — only Team & Users, the demo reset and the two npm scripts.
  `reset_demo_workspace` and `import_legacy_data` refuse any other caller.

## Migrations

| # | File | What it adds |
|---|------|--------------|
| 0001 | `0001_admin_auth.sql` | `profiles`, first account becomes the admin, `is_admin()`, `set_updated_at()` |
| 0002 | `0002_inquiries.sql` | `inquiries` — the public form (anonymous insert only) |
| 0003 | `0003_crm.sql` | `pipeline_stages` (protected first stage), `leads`, `lead_activities`, `delete_pipeline_stage()` |
| 0004 | `0004_finance.sql` | `finance_entries` ledger, `finance_monthly` / `finance_totals` views |
| 0005 | `0005_calendar.sql` | `calendar_events` |
| 0006 | `0006_email.sql` | `email_states` — read/starred/archived flags for the Resend mailbox |
| 0007 | `0007_team_roles.sql` | roles + module permissions, `can_access()`, `private` schema, module policies, profile guard |
| 0008 | `0008_demo_workspace.sql` | `workspaces`, the `workspace` column + fence on every table, `current_workspace()` |
| 0009 | `0009_notifications.sql` | `notifications`, `private.notify()`, scheduled reminders, realtime publication |
| 0010 | `0010_activity_log.sql` | `activity_log` and the generic `private.log_activity()` trigger |
| 0011 | `0011_clients.sql` | `clients`; `client_id` on leads and events |
| 0012 | `0012_record_ownership.sql` | lead owners, client account managers, assignment alerts |
| 0013 | `0013_invoices.sql` | `invoice_settings`, `invoices`, items, payments → Income, `save_invoice`, `issue_document`, `invoice_kpis` |
| 0014 | `0014_quotes.sql` | quotes on the same table, `convert_quote_to_invoice` |
| 0015 | `0015_recurring_invoices.sql` | `invoice_schedules`, `run_recurring_invoices()` (catch-up capped at 24 per schedule, 240 per run), `flowstate-recurring` cron job |
| 0016 | `0016_approvals.sql` | thresholds on `workspaces`, `approval_requests`, `decide_approval()`; finance views count approved only |
| 0017 | `0017_receipts_budgets.sql` | `receipts` bucket, `finance_attachments`, `budgets`, `budget_alerts`, `budget_status` |
| 0018 | `0018_shared_calendar.sql` | shared events (creator/admin edit), `calendar_event_attendees`, invites and reminders |
| 0019 | `0019_time_off.sql` | `time_off`, leave approvals |
| 0020 | `0020_todos.sql` | `todos`, `todo_assignees`, `todo_checklist`, recurrence, reminders |
| 0021 | `0021_comments.sql` | `comments` with @mentions on leads, clients, invoices and to-dos |
| 0022 | `0022_reports.sql` | opening balance, `report_pnl`, `report_receivables_aging`, `report_cashflow_inputs` |
| 0023 | `0023_workload.sql` | `team_workload()` — per-person rows plus the team's to-do counts |
| 0024 | `0024_global_search.sql` | `pg_trgm` indexes, `search_everything()` for ⌘K |
| 0025 | `0025_demo_seed.sql` | `reset_demo_workspace()`, `flowstate-demo-reset` cron job, link guards |
| 0026 | `0026_legacy_import.sql` | `import_legacy_data()` for `npm run import:legacy` |
| 0027 | `0027_security_hardening.sql` | admin-only re-timing / resuming of auto-issuing schedules, a year's catch-up limit, column grants on `workspaces` and the public form, stage link guard, Clients-only client threads, receipt types and caps (`receipt_room()`) |
| 0028 | `0028_promote_admin.sql` | one-off: `admin@flowstate.com` becomes a super admin (changes nothing if the account doesn't exist) |
| 0029 | `0029_desktop_sync.sql` | for the desktop app: `sync_grants` (the access rule as rows), ids on the two link tables, `save_invoice` with a chosen id, the `powersync` publication, the `mail-outbox` bucket, and the audience of private to-dos |

## Desktop app: sync and Edge Functions

The desktop app (`desktop/`) keeps an encrypted copy of the workspace on each
computer through [PowerSync](https://www.powersync.com), and reaches the two
things that need a secret — the Resend mailbox and Team & Users — through
Edge Functions. Nothing here changes the website. Once, on the project:

1. **Run 0029** (step 2 above). It also creates the `powersync` publication.
2. **A login for PowerSync** — SQL editor, with a long random password of
   your own (keep it in your password manager; it never goes in the repo):
   ```sql
   create role powersync_role with replication bypassrls login password '…';
   grant usage on schema public to powersync_role;
   grant select on all tables in schema public to powersync_role;
   alter default privileges in schema public grant select on tables to powersync_role;
   ```
   `bypassrls` is required: PowerSync copies whole tables and applies the
   read rules itself (`powersync/sync-config.yaml`), so RLS would hide rows
   from the copy. That file is the desktop's RLS — it must say what the
   policies say.
3. **PowerSync instance** — powersync.com → new instance (the free tier is
   enough to start). Database Connection → Postgres: paste the **Direct
   connection** string from Supabase's **Connect** dialog, then set the
   username to `powersync_role` and its password (replication can't go
   through Supabase's pooler; PowerSync reaches the direct connection over
   IPv6). Skip PowerSync's `CREATE PUBLICATION … FOR ALL TABLES` — 0029
   already made a narrower one. Under **Client Auth**, tick **Use Supabase
   Auth** (leave the legacy JWT secret empty on projects using the new
   signing keys) and **Save and Deploy**. Then deploy
   the sync config: check it first with `cd desktop && npm run sync:validate`,
   and paste `supabase/powersync/sync-config.yaml` into the instance's
   **Sync Streams** editor → **Validate** → **Deploy**. The instance URL is
   under **Connect** in the PowerSync dashboard; it goes in
   `FLOWSTATE_POWERSYNC_URL` (desktop `.env.local`, or the GitHub variable
   for the release workflow).
   - A stopped instance makes Postgres keep WAL for it: add a disk-usage alert,
     and delete the instance's replication slot if you ever retire it.
4. **Edge Functions** — the mailbox and Team & Users for the desktop app:
   ```bash
   node scripts/sync-edge-shared.mjs          # copies the shared mailbox/team code in
   supabase functions deploy mail
   supabase functions deploy team
   supabase secrets set RESEND_API_KEY=… EMAIL_FROM_ADDRESS=support@flowstate.lk EMAIL_FROM_NAME="Flow State" EMAIL_INBOX_ADDRESSES=support@flowstate.lk
   ```
   Supabase gives functions the project URL, anon key and service role key on
   its own. Both functions check the caller's session and access themselves.

After a migration that adds or changes a synced table: re-run
`desktop/scripts/gen-schema.mjs` against a migrated database, update and
validate the sync config, and redeploy it. The desktop's leak tests
(`desktop/test/e2e`) check, table by table, that each kind of account's
device holds exactly what RLS lets it read.

## Notes on the schema

- **Protected stage** — the `new` stage in `pipeline_stages` can't be renamed,
  moved or deleted; inquiries land there. Deleting any other stage rehomes its
  leads through `delete_pipeline_stage()`.
- **Money** — `finance_entries.amount` is always positive and `signed_amount`
  carries the sign, so profit is a plain sum. Invoice totals, statuses and the
  Income rows for payments are maintained by triggers; payments post in LKR
  (`amount_base`). Pending or rejected expenses don't count anywhere.
- **Deleting** — a client with invoices or quotes can't be deleted (archive it).
  Deleting an account keeps everything it made, with the name removed.
- **Times** — the business runs on Asia/Colombo; `public.local_today()` and
  `private.local_at()` are the SQL side of `src/lib/admin/format.ts`.
