-- dTBM schema. Idempotent: drops and recreates the app schema.
-- Isolation model: the app connects as the schema owner, but every request made
-- on behalf of a logged-in user runs inside a transaction that does
--   SET LOCAL ROLE dtbm_app;  set_config('app.user_id', <uuid>, true)
-- so the row-level security policies below decide what that user can see.
-- (On Supabase, app_user_id() becomes auth.uid() and dtbm_app becomes "authenticated".)

create extension if not exists pgcrypto;

do $$ begin
  create role dtbm_app nologin;
exception when duplicate_object then null; end $$;
grant dtbm_app to current_user;

drop schema if exists dtbm cascade;
create schema dtbm;
grant usage on schema dtbm to dtbm_app;
set search_path = dtbm, public;

-- ---------------------------------------------------------------- tables
create table groups (
  id   serial primary key,
  code text not null unique,          -- 'JL'
  name text not null
);

create table contracts (
  id              serial primary key,
  group_id        int  not null references groups(id),
  code            text not null unique,   -- 'JL111'
  name            text not null,
  main_contractor text not null,
  site_address    text not null,
  checkin_token   text not null unique default encode(gen_random_bytes(9), 'hex')
);

create table subcontractors (
  id          serial primary key,
  contract_id int  not null references contracts(id),
  name        text not null,
  trade       text not null
);
create index on subcontractors (contract_id);

create table workers (
  id               serial primary key,
  contract_id      int  not null references contracts(id),
  subcontractor_id int  not null references subcontractors(id),
  id_last4         text not null check (id_last4 ~ '^[0-9]{3}[A-Z]$'), -- last 4 chars of NRIC/FIN only
  name             text not null,
  trade            text not null,
  pin_hash         text not null,
  active           boolean not null default true,
  consent_at       timestamptz,
  unique (contract_id, id_last4)
);
create index on workers (subcontractor_id);

create table attendance (
  id               bigserial primary key,
  contract_id      int  not null references contracts(id),
  subcontractor_id int  not null references subcontractors(id),
  worker_id        int  not null references workers(id),
  work_date        date not null default (now() at time zone 'Asia/Singapore')::date,
  checkin_type     text not null check (checkin_type in ('start', 'mid')),
  checked_in_at    timestamptz not null default now(),
  checked_out_at   timestamptz,
  source           text not null default 'self' check (source in ('self', 'api')),
  external_id      text,
  unique (worker_id, work_date),
  unique (contract_id, external_id)
);
create index on attendance (contract_id, work_date);

create table health_reports (
  id            bigserial primary key,
  attendance_id bigint not null unique references attendance(id) on delete cascade,
  contract_id   int    not null references contracts(id),
  status        text   not null check (status in ('well', 'unwell')),
  remarks       text,
  followed_up   boolean not null default false,
  extra         jsonb  not null default '{}',   -- room for future check-in fields
  reported_at   timestamptz not null default now()
);
create index on health_reports (contract_id) where status = 'unwell';

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  role          text not null check (role in ('authority', 'contractor')),
  contract_id   int references contracts(id),
  check ((role = 'contractor') = (contract_id is not null))
);

-- Who gets told when a worker reports unwell. Managed by the site's contractor.
create table alert_recipients (
  id          serial primary key,
  contract_id int  not null references contracts(id),
  name        text not null,
  channel     text not null check (channel in ('email', 'telegram', 'whatsapp')),
  address     text,          -- email / Telegram chat_id / WhatsApp E.164 number; null while Telegram link pending
  active      boolean not null default true,
  link_code   text unique,   -- Telegram deep-link code until linked
  created_at  timestamptz not null default now()
);
create index on alert_recipients (contract_id);

-- Outbox: one row per (report, recipient). Written by the server only.
create table alerts (
  id               bigserial primary key,
  contract_id      int    not null references contracts(id),
  health_report_id bigint references health_reports(id) on delete cascade,  -- null for test alerts
  recipient_id     int    references alert_recipients(id) on delete set null,
  channel          text   not null,
  address          text   not null,
  body             text   not null,
  status           text   not null default 'pending'
                   check (status in ('pending', 'sending', 'sent', 'failed', 'logged')),
  attempts         int    not null default 0,
  error            text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index on alerts (contract_id, created_at desc);
create index on alerts (health_report_id);
create index on alerts (status) where status in ('pending', 'failed', 'sending');

create table audit_log (
  id          bigserial primary key,
  user_id     uuid not null,
  action      text not null,
  contract_id int,
  at          timestamptz not null default now()
);

-- ---------------------------------------------------------------- RLS helpers
create function app_user_id() returns uuid language sql stable as
$$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create function app_role() returns text language sql stable security definer
set search_path = dtbm as
$$ select role from users where id = app_user_id() $$;

create function app_contract_id() returns int language sql stable security definer
set search_path = dtbm as
$$ select contract_id from users where id = app_user_id() $$;

grant execute on function app_user_id(), app_role(), app_contract_id() to dtbm_app;

-- ---------------------------------------------------------------- policies
alter table groups         enable row level security;
alter table contracts      enable row level security;
alter table subcontractors enable row level security;
alter table workers        enable row level security;
alter table attendance     enable row level security;
alter table health_reports enable row level security;
alter table audit_log      enable row level security;
alter table alert_recipients enable row level security;
alter table alerts           enable row level security;
-- users: no grant to dtbm_app at all (login runs as owner).

grant select on groups, contracts, subcontractors, workers, attendance, health_reports to dtbm_app;
grant update (followed_up) on health_reports to dtbm_app;
grant select, insert on audit_log to dtbm_app;
grant usage on sequence audit_log_id_seq to dtbm_app;

create policy groups_read on groups for select to dtbm_app using (
  app_role() = 'authority'
  or id = (select group_id from contracts c where c.id = app_contract_id())
);
create policy contracts_read on contracts for select to dtbm_app using (
  app_role() = 'authority' or id = app_contract_id()
);
create policy subcontractors_read on subcontractors for select to dtbm_app using (
  app_role() = 'authority' or contract_id = app_contract_id()
);
create policy workers_read on workers for select to dtbm_app using (
  app_role() = 'authority' or contract_id = app_contract_id()
);
create policy attendance_read on attendance for select to dtbm_app using (
  app_role() = 'authority' or contract_id = app_contract_id()
);
create policy health_read on health_reports for select to dtbm_app using (
  app_role() = 'authority' or contract_id = app_contract_id()
);
-- Only the site's own contractor marks follow-up.
create policy health_followup on health_reports for update to dtbm_app
  using (contract_id = app_contract_id()) with check (contract_id = app_contract_id());
grant select, insert, update, delete on alert_recipients to dtbm_app;
grant usage on sequence alert_recipients_id_seq to dtbm_app;
grant select on alerts to dtbm_app;

-- Contractor manages its own site's recipients; authority can read all.
create policy recipients_read on alert_recipients for select to dtbm_app using (
  app_role() = 'authority' or contract_id = app_contract_id()
);
create policy recipients_write on alert_recipients for all to dtbm_app
  using (contract_id = app_contract_id()) with check (contract_id = app_contract_id());
create policy alerts_read on alerts for select to dtbm_app using (
  app_role() = 'authority' or contract_id = app_contract_id()
);

create policy audit_insert on audit_log for insert to dtbm_app with check (user_id = app_user_id());
create policy audit_read on audit_log for select to dtbm_app using (app_role() = 'authority');

-- ---------------------------------------------------------------- summary view
-- security_invoker so the view respects the caller's RLS.
create view daily_subcon_summary with (security_invoker = true) as
select a.work_date,
       g.code  as group_code,
       c.id    as contract_id,
       c.code  as contract_code,
       s.id    as subcontractor_id,
       s.name  as subcontractor,
       count(*)                                            as total,
       count(*) filter (where a.checkin_type = 'start')    as start,
       count(*) filter (where a.checkin_type = 'mid')      as mid,
       count(*) filter (where a.checked_out_at is null)    as still_on_site,
       count(*) filter (where h.status = 'unwell')         as unwell
from attendance a
join subcontractors s on s.id = a.subcontractor_id
join contracts c      on c.id = a.contract_id
join groups g         on g.id = c.group_id
left join health_reports h on h.attendance_id = a.id
group by a.work_date, g.code, c.id, c.code, s.id, s.name;

grant select on daily_subcon_summary to dtbm_app;
