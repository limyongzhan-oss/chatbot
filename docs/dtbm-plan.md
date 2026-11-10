# dTBM — Construction Manpower Tracking: Build Plan

_Status: approved for demo. Living document._

## Context
The authority (the owner of programmes like JL and CR) needs a daily view of manpower on every construction site. It needs to see how many workers are on each site, split by subcontractor, and who reported being unwell. Each main contractor needs the same view for its own site only. Today the repo `limyongzhan-oss/chatbot` holds only a Streamlit chatbot template (`streamlit_app.py`, `requirements.txt`). Nothing in it can be reused, so this is a greenfield build. The template will be replaced on branch `claude/dtbm-manpower-tracking-oyetey`.

**Decisions confirmed with the user**
- Hierarchy: **Group (JL, CR) → Contract (JL111) = 1 site = 1 main contractor → Subcontractors → Workers.**
- Data entry: **worker self check-in/check-out via site QR** (v1). An **API push from contractor systems** comes later (see Deferred).
- Storage: **one authority-owned Postgres with Row-Level Security (RLS)**. Each contractor's "own dataset" is the set of rows tagged with its `contract_id`, isolated by the database itself.
- Stack: **Next.js (App Router, TypeScript) + Supabase (Postgres, Auth, Edge Functions) + Tailwind/shadcn**. Deployed on Vercel + Supabase Cloud.
- Health data: **contractor and authority both see names of unwell workers.** This raises the PDPA burden: consent capture, a view audit log, and a retention limit are all required.
- Unwell flow: **record it + alert the site's safety officer** (by email in v1).

## Feature list

### Worker (public, no login, mobile web)
1. Scan the site QR (`/checkin/<site-token>`), enter the last 4 characters of NRIC/FIN + 4-digit PIN (the device remembers the worker).
2. **Check-in**, with the worker choosing the type **Start** or **Mid**. The type is the worker's choice, not derived from the clock. They then answer "Are you feeling well today?" (Yes/No + optional remarks).
3. **Check-out:** scanning the QR again while checked in offers "Check out". This confirms the worker has exited the site.
4. **No auto-close.** A worker without a check-out stays "on site", so the contractor can confirm everyone is out.
5. On first use, show the PDPA consent notice and record consent.

### Contractor (one contract/site)
1. **Today dashboard:** total checked in (start vs mid), **still on site** (not checked out), checked out, a table and bar chart by subcontractor, unwell count and %.
2. **"Not yet exited" list:** names of workers still on site, so the contractor can confirm everyone is out.
3. **Unwell list:** name, subcontractor, trade, time, remarks, and a "followed up" toggle.
4. **Date picker + 7/30-day trend.**
5. **Roster management:** CRUD for subcontractors and workers, CSV import, PIN reset, printable site QR.
6. **API keys** (later phase): generate and revoke keys for the contractor's own system push.
7. **Alert settings:** safety officer email(s).
8. CSV export.

### Authority (all sites)
1. **Overview KPIs:** total manpower today, unwell total, sites reporting vs not reporting today.
2. **Drill-down:** Group table (JL, CR) → Contract table (JL111…) → Subcontractor breakdown → Unwell names.
3. Same date picker, trends and CSV export at every level.
4. Admin: create groups and contracts, invite contractor users, view the audit log.

### Platform
- Email/password auth (Supabase Auth). Roles are `authority` and `contractor`. A contractor is bound to exactly one `contract_id`.
- Ingestion API `POST /api/v1/attendance`: bulk, idempotent on `(contract_id, external_id)`, API-key auth scoped to one contract.
- Unwell alert email (Supabase Edge Function + Resend), sent on insert of an unwell health report.
- Audit log of who viewed unwell-worker names. Scheduled job to purge health remarks after N days (default 30, configurable).

## Data model (Supabase migrations in `supabase/migrations/`)
```
groups(id, code 'JL', name)
contracts(id, group_id→groups, code 'JL111', name, main_contractor, site_address, checkin_token)
subcontractors(id, contract_id, name, uen)
workers(id, contract_id, subcontractor_id, id_last4, name, trade, pin_hash, active, consent_at)
attendance(id, contract_id, subcontractor_id, worker_id, work_date, checked_in_at,
           checkin_type 'start'|'mid', checked_out_at NULL, source 'self'|'api', external_id,
           UNIQUE(worker_id, work_date))
health_reports(id, attendance_id, contract_id, status 'well'|'unwell', remarks, followed_up, extra jsonb, reported_at)
profiles(user_id→auth.users, role 'authority'|'contractor', contract_id NULL for authority)
api_keys(id, contract_id, key_hash, label, created_by, revoked_at)
alert_recipients(id, contract_id, email)
audit_log(id, user_id, action, contract_id, at)
VIEW daily_subcon_summary(work_date, group_code, contract_code, subcontractor, total, start, mid, still_on_site, unwell)
```
**RLS:**
- Every contract-scoped table has `contract_id = auth_contract_id() OR auth_role() = 'authority'`, where `auth_contract_id()` and `auth_role()` are SQL helpers reading `profiles`.
- Contractors cannot write to other contracts' rows.
- The public check-in and the ingestion API go through server-side route handlers using the service role, after validating the site token or API key. Clients never get direct table access.
- `work_date` is computed in the `Asia/Singapore` timezone.

## App structure (Next.js, repo root; delete `streamlit_app.py`, `requirements.txt`)
- `app/login/` — sign-in, then redirect by role
- `app/(contractor)/site/` — today dashboard, `unwell/`, `roster/`, `settings/` (API keys, alerts)
- `app/(authority)/overview/` → `groups/[code]/` → `contracts/[code]/`, plus `admin/`
- `app/checkin/[token]/` — public worker page
- `app/api/v1/attendance/route.ts` — ingestion API
- `lib/supabase/{server,client}.ts`, `lib/auth.ts` (role guard in `middleware.ts`)
- `supabase/functions/unwell-alert/` — email alert
- `supabase/seed.sql` — JL111–113 and CR111–113, 3–5 subcons each, about 1,500 workers, 30 days of history

## Build phases
1. **Scaffold:** Next.js + Tailwind + shadcn, Supabase CLI local stack, CI lint/typecheck.
2. **Schema + RLS + seed**, with RLS tests written first.
3. **Auth + role routing** (middleware guard, contractor bound to its contract).
4. **Contractor dashboard + roster/CSV import + QR generation.**
5. **Authority overview with Group → Contract → Subcon → Unwell drill-down.**
6. **Worker check-in page + unwell alert function.**
7. **Ingestion API + API key management + API docs page.**
8. **Hardening:** audit log, retention job, consent, rate limiting on check-in, deploy to Vercel + Supabase.

## Verification
- **RLS tests** (pgTAP via `supabase test db`): contractor A gets 0 rows from contract B on every table, and authority reads all.
- **Unit tests** (Vitest): ingestion validation, idempotent upsert, `work_date` timezone boundary at midnight SGT.
- **End-to-end** (Playwright, local Supabase):
  1. A worker checks in as unwell via a QR URL.
  2. The alert email appears in the local Inbucket mailbox.
  3. The contractor dashboard shows the worker in the unwell list.
  4. The authority drill-down JL → JL111 → subcon shows the same worker, and an audit row is written.
  5. Contractor JL111 opening `/site` sees no CR data, and a direct URL to the authority page redirects.
- **API test:** `curl` POST with a valid key creates the attendance; a re-POST does not duplicate it; a revoked key or another contract's key returns 401/403.

## Deferred
- More worker check-in fields: the user will specify them later. Keep `health_reports` and the check-in form easy to extend, e.g. add a `extra jsonb` column now.
- **Contractor API push (phase 7):** no contractor database exists yet, and the authority has not decided how contractors take responsibility for their data. For the demo, contractors own their data *inside* dTBM: they maintain the roster and are accountable for its accuracy, while the authority hosts the system. Keep the `source` and `external_id` columns so an API or sync can be added later without schema changes.

## Worker identity (confirmed)
- A worker is identified by the **last 4 characters of NRIC/FIN** (e.g. `567A`) + name, with the subcontractor as context.
- Store it as `id_last4` on `workers`, unique per `contract_id`. Last-4 values can collide, so on a clash the check-in asks the worker to pick their name.
- Never collect the full NRIC/FIN.
- For the demo, check-in = last-4 + 4-digit PIN.

## Assumptions to confirm during build (non-blocking)
- **API contractors:** their pushes include subcontractor and worker codes that already exist in the roster. Unknown codes are rejected with an error report.
