# dTBM — construction manpower tracking

Daily headcount and worker wellness for construction sites. The data is organised as
**Group** (e.g. JL) → **Contract / site** (JL111, one main contractor) → **Subcontractor** → **Worker**.

- **Workers** scan the site QR code and enter the last 4 characters of their NRIC/FIN + a PIN.
  They check in (*Start* or *Mid*) and answer "feeling well?". They scan again to **check out**.
- **Contractor** login sees its own site only:
  - workers checked in, by subcontractor
  - who is still on site
  - who reported unwell, with follow-up tracking
  - a 14-day trend and a printable QR code for the site
- **Authority** login sees all groups → contracts → subcontractors → named unwell workers.
  Every time the authority views a page with worker names, it is written to the audit log.

This is the **thin-slice demo**. Not in it yet: the unwell email alert, roster management, the contractor API, and CSV export.
See [`docs/dtbm-plan.md`](docs/dtbm-plan.md) for the full plan.

## How data isolation works

There is one Postgres database. Isolation comes from **row-level security**, not from application code:

- Each logged-in request runs in a transaction as the restricted role `dtbm_app`, with `app.user_id` set to the user's id.
- Policies in [`db/schema.sql`](db/schema.sql) limit a contractor to the rows of its own `contract_id`.
- The authority can see every row.
- The summary view uses `security_invoker`, so it obeys the same rules.

[`db/test_rls.sql`](db/test_rls.sql) proves the isolation holds. It checks that contractor JL111 cannot read or update CR111 data, and cannot see the users table.

The design moves to Supabase almost directly: `app_user_id()` becomes `auth.uid()`, and `dtbm_app` becomes `authenticated`.

## Run it

Needs Node 20+ and Postgres 14+ (the `pgcrypto` extension must be available).

```bash
cp .env.example .env.local          # set DATABASE_URL and SESSION_SECRET
export $(cat .env.local | xargs)
npm install
npm run db:reset                    # schema + demo seed (about 2,200 workers, 30 days of history)
npm run test:rls                    # row-level security tests
npm run build && npm start          # http://localhost:3000
```

**Demo logins** (password `demo1234`):

- `authority@dtbm.demo`
- `jl111@dtbm.demo` … `jl113@dtbm.demo`
- `cr111@dtbm.demo` … `cr113@dtbm.demo`

**Worker check-in:**

- Pages are at `/checkin/jl111-demo`, `/checkin/cr112-demo`, and so on.
- Every seeded worker's PIN is `1234`.
- Try worker `042O` at JL111.
- Contractors can also open their site's QR page from the dashboard.

**End-to-end test** (needs Playwright with Chromium installed; run it against a freshly seeded database):

```bash
node tests/e2e.js 042O /tmp/shots
```
