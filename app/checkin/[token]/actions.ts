"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { dispatch, queueUnwellAlerts } from "@/lib/alerts/outbox";
import { asService } from "@/lib/db";
import { sign, verify } from "@/lib/session";

// Worker check-in is public (no account). It runs as the service, so every query
// below is explicitly scoped to the contract behind the QR token.

export type CheckinClaim = { wid: number; cid: number };
const CLAIM = "dtbm_ck";
const LAST4 = "dtbm_last4";
const path = (token: string) => `/checkin/${token}`;
const back = (token: string, e?: string): never => redirect(path(token) + (e ? `?e=${e}` : ""));

export async function readClaim(token: string, contractId: number): Promise<CheckinClaim | null> {
  const claim = await verify<CheckinClaim>((await cookies()).get(CLAIM)?.value);
  return claim && claim.cid === contractId ? claim : null;
}

export async function identify(formData: FormData) {
  const token = String(formData.get("token"));
  const last4 = String(formData.get("last4") ?? "").trim().toUpperCase();
  const pin = String(formData.get("pin") ?? "").trim();
  if (!/^[0-9]{3}[A-Z]$/.test(last4) || !/^[0-9]{4}$/.test(pin)) back(token, "format");

  const worker = await asService(async (c) => {
    const { rows } = await c.query<{ id: number; contract_id: number }>(
      `select w.id, w.contract_id from workers w join contracts c on c.id = w.contract_id
       where c.checkin_token = $1 and w.id_last4 = $2 and w.active and w.pin_hash = crypt($3, w.pin_hash)`,
      [token, last4, pin],
    );
    return rows[0];
  });
  if (!worker) back(token, "nomatch");

  const jar = await cookies();
  const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: path(token) };
  jar.set(CLAIM, await sign({ wid: worker.id, cid: worker.contract_id }, "10m"), { ...opts, maxAge: 600 });
  jar.set(LAST4, last4, { ...opts, maxAge: 90 * 24 * 3600 });
  back(token);
}

async function claimFor(token: string): Promise<CheckinClaim> {
  const claim = await verify<CheckinClaim>((await cookies()).get(CLAIM)?.value);
  if (!claim) back(token, "expired");
  const ok = await asService(async (c) =>
    (await c.query("select 1 from contracts where id = $1 and checkin_token = $2", [claim!.cid, token])).rowCount,
  );
  if (!ok) back(token, "expired");
  return claim!;
}

export async function checkIn(formData: FormData) {
  const token = String(formData.get("token"));
  const claim = await claimFor(token);
  const type = formData.get("type");
  const health = formData.get("health");
  const remarks = String(formData.get("remarks") ?? "").trim().slice(0, 300) || null;
  const consent = formData.get("consent") === "on";
  if ((type !== "start" && type !== "mid") || (health !== "well" && health !== "unwell")) back(token, "missing");

  let alertIds: number[] = [];
  const err = await asService(async (c) => {
    const w = (await c.query<{ subcontractor_id: number; consent_at: Date | null }>(
      "select subcontractor_id, consent_at from workers where id = $1 and contract_id = $2", [claim.wid, claim.cid],
    )).rows[0];
    if (!w) return "expired";
    if (!w.consent_at) {
      if (!consent) return "consent";
      await c.query("update workers set consent_at = now() where id = $1", [claim.wid]);
    }
    const a = await c.query<{ id: number }>(
      `insert into attendance (contract_id, subcontractor_id, worker_id, checkin_type)
       values ($1, $2, $3, $4) on conflict (worker_id, work_date) do nothing returning id`,
      [claim.cid, w.subcontractor_id, claim.wid, type],
    );
    if (!a.rows[0]) return null; // already checked in today: page shows current state
    const h = await c.query<{ id: number }>(
      `insert into health_reports (attendance_id, contract_id, status, remarks)
       values ($1, $2, $3, $4) returning id`,
      [a.rows[0].id, claim.cid, health, health === "unwell" ? remarks : null],
    );
    // Alerts are queued in the same transaction as the report, so neither exists without the other.
    if (health === "unwell") alertIds = await queueUnwellAlerts(c, h.rows[0].id);
    return null;
  });
  // Send after the response: the worker never waits on Telegram/email.
  if (alertIds.length) after(() => dispatch(alertIds).then(() => undefined));
  back(token, err ?? undefined);
}

export async function checkOut(formData: FormData) {
  const token = String(formData.get("token"));
  const claim = await claimFor(token);
  await asService((c) =>
    c.query(
      `update attendance set checked_out_at = now()
       where worker_id = $1 and contract_id = $2 and checked_out_at is null
         and work_date = (now() at time zone 'Asia/Singapore')::date`,
      [claim.wid, claim.cid],
    ),
  );
  back(token);
}

export async function finish(formData: FormData) {
  const token = String(formData.get("token"));
  (await cookies()).delete({ name: CLAIM, path: path(token) });
  back(token);
}

export async function rememberedLast4(): Promise<string> {
  return (await cookies()).get(LAST4)?.value ?? "";
}
