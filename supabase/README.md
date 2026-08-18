# Flow State — Supabase backend

Five migrations, one per feature. Run them **in order** in the Supabase SQL editor
(Dashboard → SQL Editor → paste → Run), or with the CLI if you have it linked:

```bash
supabase db push
```

| # | File | What it creates |
|---|------|-----------------|
| 0001 | `0001_admin_auth.sql` | `profiles`, the **first user becomes admin** trigger, `is_admin()`, `set_updated_at()` |
| 0002 | `0002_inquiries.sql` | `inquiries` — public form submissions (anyone may insert, only admins may read) |
| 0003 | `0003_crm.sql` | `pipeline_stages`, `leads`, `lead_activities`, the protected first stage, `delete_pipeline_stage()` |
| 0004 | `0004_finance.sql` | `finance_entries` (+`finance_monthly`, `finance_totals` views) — income/expense ledger |
| 0005 | `0005_calendar.sql` | `calendar_events` — the dashboard calendar |

0002–0005 depend on helpers created in 0001, and 0003 depends on 0002, so order matters.

## Creating the admin account

1. Supabase Dashboard → **Authentication → Users → Add user**, with "Auto confirm user" ticked.
2. The `on_auth_user_created` trigger writes a `profiles` row and hands the **first**
   account the `admin` role. Everyone created afterwards lands as `viewer` and
   cannot get past the login screen until an admin promotes them.
3. Already created the user before running 0001? The migration backfills existing
   `auth.users` and promotes the earliest one — no action needed.

Promoting someone later:

```sql
update public.profiles set role = 'admin' where email = 'someone@flowstate.lk';
```

## Row-level security

Every table has RLS on. The only thing an anonymous visitor can do is `insert`
into `inquiries` (that's the website form). Everything else — reading inquiries,
the CRM, the ledger, the calendar — requires `public.is_admin()`.

## App environment

```
NEXT_PUBLIC_SUPABASE_URL=…
NEXT_PUBLIC_SUPABASE_ANON_KEY=…
```

in `.env.local` (see `.env.example`). The service-role key is never used by the app.

## Notes on the schema

- **Protected stage** — the row with `slug = 'new'` in `pipeline_stages` cannot be
  renamed, repositioned or deleted; a trigger blocks it. Every other stage is
  editable, reorderable and deletable, and deleting one rehomes its leads through
  `delete_pipeline_stage()`.
- **Profit & loss** — `finance_entries.amount` is always positive.
  `signed_amount` is a generated column (`+income` / `−expense`), so profit is
  `sum(signed_amount)` and goes negative on its own when spend overtakes income.
- **Inquiry → lead** — converting sets `inquiries.status = 'converted'` and links
  `converted_lead_id`, and the new lead keeps `inquiry_id` pointing back. A unique
  index stops the same inquiry being converted twice.
