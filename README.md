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

- **Unwell alerts:** when a worker checks in as unwell, the site's recipients get an email, Telegram or WhatsApp message.
  The message has the worker's name, NRIC/FIN last 4, subcontractor and a link; the worker's remarks stay in dTBM.
  Contractors manage recipients, send test alerts and see the alert log at `/site/settings`.

This is the **thin-slice demo**. Not in it yet: roster management, the contractor API, and CSV export.
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
npm run db:reset                    # schema + demo seed (about 2,200 workers, 30 days of history). Local databases only
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

## Deploy a shareable link (Vercel + Supabase)

Supabase is used only as the Postgres database. Login stays dTBM's own `users` table.

**1. Database (Supabase)**

1. Create a project at supabase.com. Pick the **Singapore** region and set a strong database password.
2. Click **Connect** and copy the **Transaction pooler** connection string (port 6543). Replace `[YOUR-PASSWORD]` in it.
3. From your own computer, load the schema and demo data:

   ```bash
   export DATABASE_URL='postgresql://postgres.xxxx:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres'
   export DATABASE_SSL=true ALLOW_RESET=1 DEMO_PASSWORD='pick-a-password-for-the-demo-logins'
   npm run db:deploy
   ```

   `ALLOW_RESET=1` is required because the script **deletes and recreates all dTBM data**. It refuses any non-local database without it. Never run it again after real data exists.

**2. App (Vercel)**

1. At vercel.com choose **Add New → Project** and import this GitHub repo (the `main` branch once PR #1 is merged).
2. Add these environment variables:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | the pooler string from step 1 |
   | `DATABASE_SSL` | `true` |
   | `SESSION_SECRET` | 32+ random characters, e.g. from `openssl rand -hex 32`. The app refuses to log anyone in without it. |
   | `APP_URL` | `https://<your-project>.vercel.app` (used in alert links) |
   | `HIDE_DEMO_HINT` | `1` |
   | `CRON_SECRET` | any random string (protects the alert retry endpoint) |

   Add the Telegram/Resend/WhatsApp keys from *Alerts setup* below if you want live alerts.
3. Click **Deploy**. Vercel gives you the link. `vercel.json` already places functions in Singapore.
4. Open the link, log in as `authority@dtbm.demo` with the `DEMO_PASSWORD` you chose, and print the QR from a contractor dashboard (`jl111@dtbm.demo`).

**Limits to know about**

- Vercel's free **Hobby** plan runs cron only once a day and is for non-commercial use. For alert retries every few minutes, add a free pinger such as cron-job.org calling `POST <your-url>/api/alerts/dispatch` with the header `Authorization: Bearer <CRON_SECRET>`.
- Supabase free projects **pause after a week with no activity**. Fine for a demo, not for a pilot.
- Keep this hosted copy on the fictional demo data. Real NRIC/FIN last-4 and health data need a PDPA decision from the authority first.
- Workers get 5 PIN attempts per 15 minutes; after that they are locked out until the window passes.

## Alerts setup

Each channel runs in **demo mode** until its keys are set in `.env.local`. In demo mode the message is
written to the alert log but not sent. Restart the app after adding keys.

**Telegram** (free, about 2 minutes):

1. Message @BotFather, send `/newbot`, and put the token in `TELEGRAM_BOT_TOKEN` and the bot's username in `TELEGRAM_BOT_USERNAME`.
2. In *Alert settings*, add a Telegram recipient and leave the address empty. dTBM shows a `t.me/<bot>?start=<code>` link.
3. The officer opens the link and taps **Start**. Then click **Check link**.

No public URL or webhook is needed; dTBM finds the officer's chat through the bot's `getUpdates`.

**Email (Resend):**

- Create an API key and verify your sending domain.
- Set `RESEND_API_KEY` and `ALERT_EMAIL_FROM`.
- For a quick trial, Resend's `onboarding@resend.dev` sender can only deliver to your own Resend account email.

**WhatsApp (Meta Cloud API):**

- You need a verified Meta Business account, a WhatsApp phone number ID and a permanent access token.
- You also need a message template approved by Meta, because WhatsApp only allows business-initiated messages through templates.
- Submit a *Utility* template named `dtbm_unwell`, language `en`, with this body:

  > dTBM alert: {{1}}

- Set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` and `WHATSAPP_TEMPLATE`.
- Approval usually takes from a few hours to a few days.

**Retries:**

- Alerts are sent right after the check-in response, so the worker never waits on Telegram or email.
- A failed alert is retried by `POST /api/alerts/dispatch` with `Authorization: Bearer $CRON_SECRET`. Run that every few minutes from cron or Vercel Cron.
- Each alert gets at most 3 attempts.

**Alert tests:**

- `tests/stub-providers.js` imitates the three provider APIs locally.
- `tests/alerts.js` checks against it:
  - the exact requests dTBM sends
  - that the worker's remarks never leave the app
  - failure and retry
  - the Telegram link flow
- Run commands are at the top of each file.
- These tests prove the request shape. Real delivery needs real keys.

**End-to-end test** (needs Playwright with Chromium installed; run it against a freshly seeded database):

```bash
node tests/e2e.js 042O /tmp/shots
```
