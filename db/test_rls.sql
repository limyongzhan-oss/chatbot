-- Row-level security tests. Run: npm run test:rls  (fails loudly on any violation)
set search_path = dtbm, public;
\set ON_ERROR_STOP 1

create or replace function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('app.user_id', (select id::text from dtbm.users where email = p_email), true);
  execute 'set local role dtbm_app';
end $$;

create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL: %', label; end if;
  raise notice 'ok: %', label;
end $$;

-- Contractor JL111 sees only JL111.
begin;
select pg_temp.as_user('jl111@dtbm.demo');
select pg_temp.check((select array_agg(code) from contracts) = array['JL111'], 'jl111 sees only its contract');
select pg_temp.check((select array_agg(code) from groups) = array['JL'], 'jl111 sees only its group');
select pg_temp.check(not exists (select 1 from workers w join contracts c on c.id = w.contract_id where c.code <> 'JL111'), 'jl111 workers isolated');
select pg_temp.check((select count(distinct contract_id) from attendance) = 1, 'jl111 attendance isolated');
select pg_temp.check((select count(distinct contract_id) from health_reports) = 1, 'jl111 health isolated');
select pg_temp.check((select count(distinct contract_code) from daily_subcon_summary) = 1, 'summary view respects RLS');
select pg_temp.check((select count(*) from audit_log) = 0, 'contractor cannot read audit log');
select pg_temp.check((select count(distinct contract_id) from alert_recipients) = 1, 'jl111 recipients isolated');
select pg_temp.check(not exists (select 1 from alerts where contract_id <> app_contract_id()), 'jl111 alerts isolated');
rollback;

-- Contractor manages its own recipients but cannot add one to another site, or write alerts.
begin;
select pg_temp.as_user('jl111@dtbm.demo');
insert into alert_recipients (contract_id, name, channel, address)
  values (app_contract_id(), 'New officer', 'email', 'new@example.com');
select pg_temp.check((select count(*) from alert_recipients where address = 'new@example.com') = 1, 'jl111 can add own recipient');
do $$ begin
  insert into dtbm.alert_recipients (contract_id, name, channel, address)
    values ((select id from dtbm.contracts where code = 'JL112'), 'Intruder', 'email', 'x@example.com');
  raise exception 'FAIL: jl111 added recipient to another site';
exception when insufficient_privilege then raise notice 'ok: cannot add recipient to other site';
end $$;
do $$ begin
  insert into dtbm.alerts (contract_id, channel, address, body) values (dtbm.app_contract_id(), 'email', 'x', 'x');
  raise exception 'FAIL: contractor wrote to alerts outbox';
exception when insufficient_privilege then raise notice 'ok: alerts outbox is server-only';
end $$;
rollback;

-- Contractor JL111 cannot update CR111 health rows.
begin;
select count(*) as cr_before from health_reports h join contracts c on c.id = h.contract_id
  where c.code = 'CR111' and h.followed_up \gset
select pg_temp.as_user('jl111@dtbm.demo');
update health_reports set followed_up = true
  where contract_id = (select id from contracts where code = 'CR111');
reset role;
select pg_temp.check((select count(*) from health_reports h join contracts c on c.id = h.contract_id
  where c.code = 'CR111' and h.followed_up) = :cr_before, 'jl111 cannot update cr111 rows');
rollback;

-- Contractor has no access to users table.
begin;
select pg_temp.as_user('jl111@dtbm.demo');
do $$ begin
  perform 1 from dtbm.users;
  raise exception 'FAIL: contractor read users';
exception when insufficient_privilege then raise notice 'ok: users table hidden';
end $$;
rollback;

-- No session = no rows.
begin;
set local role dtbm_app;
select pg_temp.check((select count(*) from attendance) = 0, 'anonymous sees nothing');
rollback;

-- Authority sees everything.
begin;
select pg_temp.as_user('authority@dtbm.demo');
select pg_temp.check((select count(*) from contracts) = 6, 'authority sees all contracts');
select pg_temp.check((select count(distinct contract_id) from attendance) = 6, 'authority sees all attendance');
rollback;

\echo 'All RLS tests passed'
