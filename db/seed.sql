-- Demo seed: 2 groups, 6 contracts, subcontractors, ~1,500 workers, 30 days of attendance.
-- All names are fictional. Every worker PIN is 1234; every user password is demo1234.
set search_path = dtbm, public;
select setseed(0.42);

insert into groups (code, name) values
  ('JL', 'Jade Line'),
  ('CR', 'Coral Ring');

insert into contracts (group_id, code, name, main_contractor, site_address, checkin_token) values
  ((select id from groups where code='JL'), 'JL111', 'JL Station A & Tunnels',  'Meridian Civil Pte Ltd',      '12 Woodlands Ave 9',    'jl111-demo'),
  ((select id from groups where code='JL'), 'JL112', 'JL Station B',            'Tanjong Builders Pte Ltd',    '40 Bukit Batok Rd',     'jl112-demo'),
  ((select id from groups where code='JL'), 'JL113', 'JL Depot',                'Harbourstone Engineering',    '5 Tuas South Link',     'jl113-demo'),
  ((select id from groups where code='CR'), 'CR111', 'CR Viaduct North',        'Kestrel Infrastructure',      '88 Yio Chu Kang Rd',    'cr111-demo'),
  ((select id from groups where code='CR'), 'CR112', 'CR Interchange Station',  'Meridian Civil Pte Ltd',      '2 Loyang Way',          'cr112-demo'),
  ((select id from groups where code='CR'), 'CR113', 'CR Tunnels East',         'Orchid Bay Construction',     '17 Pasir Ris Dr 1',     'cr113-demo');

-- 3–5 subcontractors per contract, drawn from a fictional pool.
with pool(name, trade) as (values
  ('Apex Rebar Works', 'Rebar'), ('Lion Formwork', 'Formwork'), ('Everbright M&E', 'M&E'),
  ('Sunrise Scaffolding', 'Scaffolding'), ('Delta Concreting', 'Concrete'), ('Bluewater Piling', 'Piling'),
  ('Northstar Waterproofing', 'Waterproofing'), ('Granite Excavation', 'Earthworks'))
insert into subcontractors (contract_id, name, trade)
select c.id, p.name, p.trade
from contracts c
cross join lateral (
  select * from pool order by md5(pool.name || c.code) limit 3 + (c.id % 3)
) p;

-- Workers: 50–110 per subcontractor, unique last-4 (3 digits + letter) per contract.
with raw as (
  select s.contract_id, s.id as subcontractor_id, s.trade,
         row_number() over (partition by s.contract_id order by s.id, g) as rn
  from subcontractors s
  cross join lateral generate_series(1, 50 + abs(hashtext(s.id::text || 'n')) % 60) g
)
insert into workers (contract_id, subcontractor_id, id_last4, name, trade, pin_hash, consent_at)
select contract_id, subcontractor_id,
       lpad(((rn * 7) % 1000)::text, 3, '0') || chr((65 + (rn * 11) % 26)::int),
       (array['Rahman','Kumar','Wei','Aung','Hossain','Ravi','Ming','Thura','Islam','Suresh','Jun','Kyaw','Alam','Murugan','Hao','Zaw','Karim','Siva','Lei','Min'])[1 + (rn * 7 + contract_id) % 20]
         || ' ' ||
       (array['Md','Abdul','Raj','Chen','Tan','Lin','Ali','Nair','Htet','Uddin','Pillai','Zhang','Win','Miah','Das'])[1 + (rn * 13 + contract_id * 3) % 15],
       trade, crypt('1234', gen_salt('bf', 4)), now() - interval '40 days'
from raw;

-- 30 days of attendance (Asia/Singapore dates). ~85% turnout, ~35% on Sundays.
-- Past days: almost everyone checked out; a few never did. Today: ~25% checked out so far.
with days as (
  select d::date as work_date
  from generate_series((now() at time zone 'Asia/Singapore')::date - 29,
                       (now() at time zone 'Asia/Singapore')::date, interval '1 day') d
), picked as (
  select w.*, d.work_date,
         d.work_date = (now() at time zone 'Asia/Singapore')::date as is_today,
         abs(hashtext(w.id || 's' || d.work_date)) % 100 < 90 as is_start
  from workers w cross join days d
  -- hash-based so each worker/day is decided independently (random() here gets evaluated per day)
  where abs(hashtext(w.id || ':' || d.work_date)) % 100
        < case when extract(dow from d.work_date) = 0 then 35 else 85 end
)
insert into attendance (contract_id, subcontractor_id, worker_id, work_date, checkin_type,
                        checked_in_at, checked_out_at)
select contract_id, subcontractor_id, id, work_date,
       case when is_start then 'start' else 'mid' end,
       least(now(), (work_date + case when is_start then time '07:00' else time '11:30' end
                       + random() * interval '90 minutes') at time zone 'Asia/Singapore'),
       case
         when is_today and random() < 0.75 then null
         when not is_today and random() < 0.01 then null
         else least(now(), (work_date + time '17:30' + random() * interval '90 minutes') at time zone 'Asia/Singapore')
       end
from picked;

-- Health: ~2% unwell.
insert into health_reports (attendance_id, contract_id, status, remarks, followed_up, reported_at)
select a.id, a.contract_id,
       case when r < 0.02 then 'unwell' else 'well' end,
       case when r < 0.02 then (array['Fever','Headache and dizziness','Sore throat','Stomach pain','Back pain','Feeling weak'])[1 + floor(r * 300)::int % 6] end,
       r < 0.02 and a.work_date < (now() at time zone 'Asia/Singapore')::date,
       a.checked_in_at
from (select a.*, random() as r from attendance a) a;

-- Users (password demo1234).
insert into users (email, password_hash, role, contract_id)
select 'authority@dtbm.demo', crypt('demo1234', gen_salt('bf', 8)), 'authority', null
union all
select lower(code) || '@dtbm.demo', crypt('demo1234', gen_salt('bf', 8)), 'contractor', id from contracts;
