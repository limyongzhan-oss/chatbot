import Link from "next/link";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { asService, asUser } from "@/lib/db";
import { getContract } from "@/lib/queries";
import {
  CHANNELS, CHANNEL_LABEL, findTelegramChat, isLive, telegramBotUsername, validAddress, type Channel,
} from "@/lib/alerts/channels";
import { dispatch, queueTestAlert } from "@/lib/alerts/outbox";
import { TopBar } from "@/components/ui";

const back = (q = ""): never => redirect(`/site/settings${q}`);

const MESSAGES: Record<string, string> = {
  invalid: "Check the details: name is required; email must be valid, Telegram chat ID is digits, WhatsApp is +65… format.",
  added: "Recipient added.",
  "tg-link": "Recipient added. Ask them to open the Telegram link below and tap Start, then click Check link.",
  "tg-wait": "Not linked yet: no /start message with that code. Ask them to open the link and tap Start, then try again.",
  "tg-off": "Telegram bot is not configured (TELEGRAM_BOT_TOKEN), so linking can't be checked. Enter the chat ID instead.",
  "tg-err": "Couldn't reach Telegram. Try again shortly.",
  linked: "Telegram linked.",
  "test-sent": "Test alert sent.",
  "test-logged": "Demo mode: test alert recorded in the log, not sent (no API key for this channel).",
  "test-failed": "Test alert failed — see the alert log for the error.",
  "test-none": "This recipient is inactive or not linked yet.",
};

async function addRecipient(formData: FormData) {
  "use server";
  const s = await requireRole("contractor");
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const channel = String(formData.get("channel")) as Channel;
  const address = String(formData.get("address") ?? "").trim().replace(/\s+/g, "");
  if (!name || !CHANNELS.includes(channel)) back("?e=invalid");

  // Telegram with no chat ID -> deep-link flow.
  const linkFlow = channel === "telegram" && !address;
  if (!linkFlow && !validAddress(channel, address)) back("?e=invalid");

  await asUser(s.uid, (c) =>
    c.query(
      `insert into alert_recipients (contract_id, name, channel, address, link_code)
       values (app_contract_id(), $1, $2, $3, $4)`,
      [name, channel, linkFlow ? null : address, linkFlow ? randomBytes(6).toString("hex") : null],
    ),
  );
  back(linkFlow ? "?ok=tg-link" : "?ok=added");
}

async function toggleRecipient(formData: FormData) {
  "use server";
  const s = await requireRole("contractor");
  await asUser(s.uid, (c) =>
    c.query("update alert_recipients set active = not active where id = $1", [Number(formData.get("id"))]),
  );
  back();
}

async function removeRecipient(formData: FormData) {
  "use server";
  const s = await requireRole("contractor");
  await asUser(s.uid, (c) => c.query("delete from alert_recipients where id = $1", [Number(formData.get("id"))]));
  back();
}

async function checkTelegramLink(formData: FormData) {
  "use server";
  const s = await requireRole("contractor");
  const id = Number(formData.get("id"));
  const r = await asUser(s.uid, async (c) =>
    (await c.query<{ link_code: string | null }>("select link_code from alert_recipients where id = $1", [id])).rows[0],
  );
  if (!r?.link_code) back();
  if (!isLive("telegram")) back("?e=tg-off");
  let chat: string | null;
  try { chat = await findTelegramChat(r!.link_code!); } catch { back("?e=tg-err"); }
  if (!chat!) back("?e=tg-wait");
  await asUser(s.uid, (c) =>
    c.query("update alert_recipients set address = $2, link_code = null where id = $1", [id, chat]),
  );
  back("?ok=linked");
}

async function sendTest(formData: FormData) {
  "use server";
  const s = await requireRole("contractor");
  const id = Number(formData.get("id"));
  // Visibility check under RLS first; the outbox insert itself is server-only.
  const mine = await asUser(s.uid, async (c) =>
    (await c.query("select 1 from alert_recipients where id = $1", [id])).rowCount,
  );
  if (!mine) back();
  const ids = await asService((c) => queueTestAlert(c, id, s.email));
  const latest = async () => asService(async (c) =>
    (await c.query<{ status: string }>(
      "select status from alerts where recipient_id = $1 order by id desc limit 1", [id],
    )).rows[0]?.status);
  if (ids.length) await dispatch(ids);
  const status = await latest();
  back(`?ok=${status === "sent" ? "test-sent" : status === "logged" ? "test-logged" : status === "failed" ? "test-failed" : "test-none"}`);
}

type Recipient = { id: number; name: string; channel: Channel; address: string | null; active: boolean; link_code: string | null };
type AlertRow = { id: number; at: string; name: string | null; channel: Channel; address: string; status: string; error: string | null; body: string; is_test: boolean };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const session = await requireRole("contractor");
  const { e, ok } = await searchParams;
  const { contract, recipients, log } = await asUser(session.uid, async (c) => ({
    contract: await getContract(c, { id: session.cid! }),
    recipients: (await c.query<Recipient>(
      "select id, name, channel, address, active, link_code from alert_recipients order by active desc, name, channel",
    )).rows,
    log: (await c.query<AlertRow>(
      `select a.id, to_char(a.created_at at time zone 'Asia/Singapore', 'DD Mon HH24:MI') as at,
              r.name, a.channel, a.address, a.status, a.error, a.body, a.health_report_id is null as is_test
       from alerts a left join alert_recipients r on r.id = a.recipient_id
       order by a.id desc limit 50`,
    )).rows,
  }));
  if (!contract) throw new Error("Contract not visible to this user");
  const bot = telegramBotUsername();

  return (
    <>
      <TopBar session={session} />
      <main className="page">
        <div className="head">
          <div className="grow">
            <div className="crumbs"><Link href="/site">{contract.code} dashboard</Link> › Alert settings</div>
            <h1>Unwell alerts</h1>
            <div className="muted small">
              When a worker checks in as unwell, every active recipient below is notified with the worker&apos;s
              name, NRIC/FIN last 4, subcontractor and a link. Remarks stay in dTBM.
            </div>
          </div>
        </div>

        {e && MESSAGES[e] && <div className="err">{MESSAGES[e]}</div>}
        {ok && MESSAGES[ok] && <div className="note">{MESSAGES[ok]}</div>}

        <div className="kpis">
          {CHANNELS.map((ch) => (
            <div className="kpi" key={ch}>
              <div className="label">{CHANNEL_LABEL[ch]}</div>
              <div style={{ marginTop: 6 }}>
                {isLive(ch) ? <span className="pill good">Live</span> : <span className="pill">Demo mode</span>}
              </div>
              <div className="sub">{isLive(ch) ? "Messages are delivered" : "Messages are logged, not sent"}</div>
            </div>
          ))}
        </div>

        <div className="grid cols-2">
          <section className="card">
            <h2>Recipients <span className="pill">{recipients.filter((r) => r.active && r.address).length} active</span></h2>
            {recipients.length === 0 ? <p className="empty">No recipients yet — nobody will be alerted.</p> : (
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Name</th><th>Channel</th><th>Address</th><th></th></tr></thead>
                  <tbody>
                    {recipients.map((r) => (
                      <tr key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
                        <td>{r.name}{!r.active && <div className="small muted">Paused</div>}</td>
                        <td>{CHANNEL_LABEL[r.channel]}</td>
                        <td className="small" style={{ wordBreak: "break-all" }}>
                          {r.address ?? (
                            <>
                              <span className="pill warn">Not linked</span>
                              {bot && <div><a href={`https://t.me/${bot}?start=${r.link_code}`}>t.me/{bot}?start={r.link_code}</a></div>}
                              {!bot && <div className="muted">Code: {r.link_code}</div>}
                            </>
                          )}
                        </td>
                        <td>
                          <div className="actions">
                            {r.address ? (
                              <form action={sendTest}><input type="hidden" name="id" value={r.id} />
                                <button className="btn small" type="submit" disabled={!r.active}>Send test</button></form>
                            ) : (
                              <form action={checkTelegramLink}><input type="hidden" name="id" value={r.id} />
                                <button className="btn small" type="submit">Check link</button></form>
                            )}
                            <form action={toggleRecipient}><input type="hidden" name="id" value={r.id} />
                              <button className="btn small ghost" type="submit">{r.active ? "Pause" : "Resume"}</button></form>
                            <form action={removeRecipient}><input type="hidden" name="id" value={r.id} />
                              <button className="btn small ghost" type="submit" aria-label={`Remove ${r.name}`}>Remove</button></form>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Add recipient</h2>
            <form action={addRecipient}>
              <label className="field">Name / role<input name="name" required maxLength={80} placeholder="e.g. Safety Officer — Tan" /></label>
              <label className="field">Channel
                <select name="channel" defaultValue="email" style={{ display: "block", width: "100%", marginTop: 6 }}>
                  {CHANNELS.map((ch) => <option key={ch} value={ch}>{CHANNEL_LABEL[ch]}</option>)}
                </select>
              </label>
              <label className="field">Address
                <input name="address" maxLength={120} placeholder="email@company.sg · +6591234567 · Telegram chat ID" />
              </label>
              <p className="small muted" style={{ marginTop: -6 }}>
                Telegram: leave the address empty to get a link the officer taps to connect the bot
                {bot ? <> (@{bot})</> : null}. WhatsApp: full number with country code.
              </p>
              <button className="btn" type="submit">Add recipient</button>
            </form>
          </section>
        </div>

        <section className="card" style={{ marginTop: 16 }}>
          <h2>Alert log <span className="pill">last {log.length}</span></h2>
          {log.length === 0 ? <p className="empty">No alerts yet.</p> : (
            <div className="tablewrap list">
              <table>
                <thead><tr><th>Time</th><th>Recipient</th><th>Channel</th><th>Status</th><th>Message</th></tr></thead>
                <tbody>
                  {log.map((a) => (
                    <tr key={a.id}>
                      <td className="tnum" style={{ whiteSpace: "nowrap" }}>{a.at}</td>
                      <td>{a.name ?? <span className="muted">(removed)</span>}<div className="small muted" style={{ wordBreak: "break-all" }}>{a.address}</div></td>
                      <td>{CHANNEL_LABEL[a.channel]}{a.is_test && <div className="small muted">test</div>}</td>
                      <td><StatusPill s={a.status} />{a.error && <div className="small" style={{ color: "var(--bad)" }}>{a.error}</div>}</td>
                      <td className="small">{a.body}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function StatusPill({ s }: { s: string }) {
  const cls = s === "sent" ? "good" : s === "failed" ? "bad" : s === "logged" ? "" : "warn";
  const label = s === "logged" ? "demo" : s;
  return <span className={`pill ${cls}`}>{label}</span>;
}
