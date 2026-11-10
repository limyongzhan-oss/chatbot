import "server-only";
import type { Db } from "./db";

// All functions take a client from asUser(): RLS limits what each caller can see,
// so the same query serves a contractor (own site) and the authority (everything).

export type Totals = { total: number; start: number; mid: number; still_on_site: number; unwell: number };

const TOTAL_COLS = `
  coalesce(sum(total), 0)::int         as total,
  coalesce(sum(start), 0)::int         as start,
  coalesce(sum(mid), 0)::int           as mid,
  coalesce(sum(still_on_site), 0)::int as still_on_site,
  coalesce(sum(unwell), 0)::int        as unwell`;

export type Contract = {
  id: number; code: string; name: string; main_contractor: string;
  site_address: string; checkin_token: string; group_code: string; group_name: string;
};

export async function getContract(c: Db, by: { id?: number; code?: string }): Promise<Contract | null> {
  const { rows } = await c.query<Contract>(
    `select c.id, c.code, c.name, c.main_contractor, c.site_address, c.checkin_token,
            g.code as group_code, g.name as group_name
     from contracts c join groups g on g.id = c.group_id
     where c.id = $1 or c.code = $2`,
    [by.id ?? null, by.code ?? null],
  );
  return rows[0] ?? null;
}

export async function siteTotals(c: Db, contractId: number, date: string): Promise<Totals> {
  const { rows } = await c.query<Totals>(
    `select ${TOTAL_COLS} from daily_subcon_summary where contract_id = $1 and work_date = $2`,
    [contractId, date],
  );
  return rows[0];
}

export type SubconRow = Totals & { id: number; name: string; trade: string; roster: number };

export async function subconBreakdown(c: Db, contractId: number, date: string): Promise<SubconRow[]> {
  const { rows } = await c.query<SubconRow>(
    `select s.id, s.name, s.trade,
            (select count(*)::int from workers w where w.subcontractor_id = s.id and w.active) as roster,
            coalesce(v.total, 0)::int as total, coalesce(v.start, 0)::int as start,
            coalesce(v.mid, 0)::int as mid, coalesce(v.still_on_site, 0)::int as still_on_site,
            coalesce(v.unwell, 0)::int as unwell
     from subcontractors s
     left join daily_subcon_summary v on v.subcontractor_id = s.id and v.work_date = $2
     where s.contract_id = $1
     order by total desc, s.name`,
    [contractId, date],
  );
  return rows;
}

export type PersonRow = {
  attendance_id: number; health_id: number | null; name: string; id_last4: string;
  subcontractor: string; trade: string; checkin_type: string; checked_in: string;
  checked_out: string | null; remarks: string | null; followed_up: boolean | null;
} & AlertCounts;

export type AlertCounts = {
  alerts_sent: number; alerts_logged: number; alerts_failed: number; alerts_pending: number;
};

const PERSON_SELECT = `
  select a.id as attendance_id, h.id as health_id, w.name, w.id_last4, s.name as subcontractor, w.trade,
         a.checkin_type,
         to_char(a.checked_in_at at time zone 'Asia/Singapore', 'HH24:MI') as checked_in,
         to_char(a.checked_out_at at time zone 'Asia/Singapore', 'HH24:MI') as checked_out,
         h.remarks, h.followed_up,
         coalesce(al.sent, 0)::int as alerts_sent, coalesce(al.logged, 0)::int as alerts_logged,
         coalesce(al.failed, 0)::int as alerts_failed, coalesce(al.pending, 0)::int as alerts_pending
  from attendance a
  join workers w on w.id = a.worker_id
  join subcontractors s on s.id = a.subcontractor_id
  left join health_reports h on h.attendance_id = a.id
  left join lateral (
    select count(*) filter (where status = 'sent')                   as sent,
           count(*) filter (where status = 'logged')                 as logged,
           count(*) filter (where status = 'failed')                 as failed,
           count(*) filter (where status in ('pending', 'sending'))  as pending
    from alerts where health_report_id = h.id and h.status = 'unwell'
  ) al on true`;

export async function unwellList(c: Db, contractId: number, date: string): Promise<PersonRow[]> {
  const { rows } = await c.query<PersonRow>(
    `${PERSON_SELECT} where a.contract_id = $1 and a.work_date = $2 and h.status = 'unwell'
     order by h.followed_up, a.checked_in_at`,
    [contractId, date],
  );
  return rows;
}

export async function notExitedList(c: Db, contractId: number, date: string): Promise<PersonRow[]> {
  const { rows } = await c.query<PersonRow>(
    `${PERSON_SELECT} where a.contract_id = $1 and a.work_date = $2 and a.checked_out_at is null
     order by s.name, w.name`,
    [contractId, date],
  );
  return rows;
}

export type TrendPoint = { work_date: string; total: number; unwell: number };

/** Last 14 days ending at `date`, optionally narrowed to a group or contract. */
export async function trend(
  c: Db, date: string, scope: { contractId?: number; groupCode?: string } = {},
): Promise<TrendPoint[]> {
  const { rows } = await c.query<TrendPoint>(
    `select d::date::text as work_date,
            coalesce(sum(v.total), 0)::int as total, coalesce(sum(v.unwell), 0)::int as unwell
     from generate_series($1::date - 13, $1::date, interval '1 day') d
     left join daily_subcon_summary v on v.work_date = d::date
          and ($2::int is null or v.contract_id = $2)
          and ($3::text is null or v.group_code = $3)
     group by d order by d`,
    [date, scope.contractId ?? null, scope.groupCode ?? null],
  );
  return rows;
}

export type GroupRow = Totals & { code: string; name: string; contracts: number; reporting: number };

export async function groupOverview(c: Db, date: string): Promise<GroupRow[]> {
  const { rows } = await c.query<GroupRow>(
    `select g.code, g.name,
            (select count(*)::int from contracts c where c.group_id = g.id) as contracts,
            count(distinct v.contract_id)::int as reporting,
            ${TOTAL_COLS}
     from groups g
     left join daily_subcon_summary v on v.group_code = g.code and v.work_date = $1
     group by g.id order by g.code`,
    [date],
  );
  return rows;
}

export type ContractRow = Totals & { code: string; name: string; main_contractor: string; subcons: number };

export async function contractsInGroup(c: Db, groupCode: string, date: string): Promise<ContractRow[]> {
  const { rows } = await c.query<ContractRow>(
    `select c.code, c.name, c.main_contractor,
            (select count(*)::int from subcontractors s where s.contract_id = c.id) as subcons,
            ${TOTAL_COLS}
     from contracts c
     join groups g on g.id = c.group_id
     left join daily_subcon_summary v on v.contract_id = c.id and v.work_date = $2
     where g.code = $1
     group by c.id order by c.code`,
    [groupCode, date],
  );
  return rows;
}

export async function groupName(c: Db, code: string): Promise<string | null> {
  const { rows } = await c.query<{ name: string }>(`select name from groups where code = $1`, [code]);
  return rows[0]?.name ?? null;
}
