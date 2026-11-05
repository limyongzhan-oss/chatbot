import "server-only";
import { asService, type Db } from "@/lib/db";
import { isLive, send, type Channel, type Message } from "./channels";

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Name + link only. Remarks stay in the app (PDPA: messages live on phones we don't control). */
function messageFor(body: string, contractCode: string, isTest: boolean): Message {
  return {
    subject: isTest ? `dTBM ${contractCode}: test alert` : `dTBM ${contractCode}: worker reported unwell`,
    text: body,
    link: `${appUrl()}/site`,
  };
}

/**
 * Queue one alert per active recipient for an unwell report. Call inside the check-in
 * transaction so the report and its alerts commit together. Returns alert ids to dispatch.
 */
export async function queueUnwellAlerts(c: Db, healthReportId: number): Promise<number[]> {
  const { rows: [info] } = await c.query<{ contract_id: number; code: string; name: string; id_last4: string; subcon: string; at: string }>(
    `select h.contract_id, c.code, w.name, w.id_last4, s.name as subcon,
            to_char(h.reported_at at time zone 'Asia/Singapore', 'HH24:MI') as at
     from health_reports h
     join attendance a on a.id = h.attendance_id
     join workers w on w.id = a.worker_id
     join subcontractors s on s.id = a.subcontractor_id
     join contracts c on c.id = h.contract_id
     where h.id = $1`,
    [healthReportId],
  );
  if (!info) return [];
  const body = `dTBM ${info.code}: ${info.name} (…${info.id_last4}, ${info.subcon}) reported unwell at ${info.at}. ` +
               `Details: ${appUrl()}/site`;
  return insertAlerts(c, info.contract_id, healthReportId, body, null);
}

/** A test message to one recipient (settings page). */
export async function queueTestAlert(c: Db, recipientId: number, by: string): Promise<number[]> {
  const { rows: [r] } = await c.query<{ contract_id: number; code: string }>(
    `select r.contract_id, c.code from alert_recipients r join contracts c on c.id = r.contract_id where r.id = $1`,
    [recipientId],
  );
  if (!r) return [];
  const body = `dTBM ${r.code}: test alert sent by ${by}. Unwell-worker alerts for this site will arrive here. ` +
               `Details: ${appUrl()}/site`;
  return insertAlerts(c, r.contract_id, null, body, recipientId);
}

async function insertAlerts(c: Db, contractId: number, healthReportId: number | null, body: string,
                            onlyRecipient: number | null): Promise<number[]> {
  const { rows } = await c.query<{ id: number; channel: Channel }>(
    `insert into alerts (contract_id, health_report_id, recipient_id, channel, address, body)
     select contract_id, $2, id, channel, address, $3 from alert_recipients
     where contract_id = $1 and active and address is not null and ($4::int is null or id = $4)
     returning id, channel`,
    [contractId, healthReportId, body, onlyRecipient],
  );
  // Demo mode: channels without credentials are recorded, not sent.
  const demo = rows.filter((r) => !isLive(r.channel)).map((r) => r.id);
  if (demo.length) {
    await c.query(`update alerts set status = 'logged', sent_at = now() where id = any($1)`, [demo]);
  }
  return rows.filter((r) => isLive(r.channel)).map((r) => r.id);
}

/**
 * Send pending alerts (or the given ids). Claims rows with SKIP LOCKED so concurrent
 * dispatchers (after-response hook + cron retry) never double-send. Max 3 attempts.
 */
export async function dispatch(ids?: number[]): Promise<{ sent: number; failed: number }> {
  if (ids && ids.length === 0) return { sent: 0, failed: 0 };
  const claimed = await asService(async (c) =>
    (await c.query<{ id: number; channel: Channel; address: string; body: string; code: string; is_test: boolean }>(
      `update alerts a set status = 'sending', attempts = a.attempts + 1
       from contracts c
       where c.id = a.contract_id and a.id in (
         select id from alerts
         where attempts < 3
           and (status in ('pending', 'failed')
                or (status = 'sending' and created_at < now() - interval '5 minutes'))
           and ($1::bigint[] is null or id = any($1))
         order by id limit 50
         for update skip locked)
       returning a.id, a.channel, a.address, a.body, c.code, a.health_report_id is null as is_test`,
      [ids ?? null],
    )).rows,
  );

  let sent = 0, failed = 0;
  for (const a of claimed) {
    if (!isLive(a.channel)) {
      await asService((c) => c.query(`update alerts set status = 'logged', sent_at = now() where id = $1`, [a.id]));
      continue;
    }
    try {
      await send(a.channel, a.address, messageFor(a.body, a.code, a.is_test));
      await asService((c) => c.query(`update alerts set status = 'sent', sent_at = now(), error = null where id = $1`, [a.id]));
      sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await asService((c) => c.query(`update alerts set status = 'failed', error = $2 where id = $1`, [a.id, msg.slice(0, 500)]));
      failed++;
    }
  }
  return { sent, failed };
}
