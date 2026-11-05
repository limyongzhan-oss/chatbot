// Live-path alert test against tests/stub-providers.js (needs Playwright + Chromium).
// Start the stub on :4010 and the app with fake keys + *_API_BASE pointing at it and
// CRON_SECRET=test-cron, on a freshly seeded DB. Then: node tests/alerts.js
const { chromium } = require("playwright");
const { Client } = require("pg");

const BASE = "http://localhost:3000";
const STUB = "http://127.0.0.1:4010";
const db = new Client({ connectionString: process.env.DATABASE_URL });
const assert = (ok, msg) => { if (!ok) throw new Error("FAIL: " + msg); console.log("ok:", msg); };
const stub = (p, body) => fetch(STUB + p, { method: body ? "POST" : "GET", body: body && JSON.stringify(body) }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freshJl111Worker() {
  const { rows } = await db.query(`
    select w.id_last4 from dtbm.workers w join dtbm.contracts c on c.id = w.contract_id
    where c.code = 'JL111' and not exists (
      select 1 from dtbm.attendance a where a.worker_id = w.id and a.work_date = (now() at time zone 'Asia/Singapore')::date)
    order by w.id limit 1`);
  return rows[0].id_last4;
}

async function checkInUnwell(browser, last4, remarks) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/checkin/jl111-demo`);
  await page.fill("input[name=last4]", last4);
  await page.fill("input[name=pin]", "1234");
  await page.click("text=Continue");
  await page.waitForSelector("text=Check-in type");
  await page.click("label[for=h-unwell]");
  await page.fill("textarea[name=remarks]", remarks);
  await page.click("text=Check in");
  await page.waitForSelector("text=Checked in at");
  const text = await page.textContent("main");
  await page.context().close();
  return text;
}

async function alertStatuses(last4) {
  const { rows } = await db.query(`
    select al.channel, al.status, al.error from dtbm.alerts al
    join dtbm.health_reports h on h.id = al.health_report_id
    join dtbm.attendance a on a.id = h.attendance_id
    join dtbm.workers w on w.id = a.worker_id
    where w.id_last4 = $1 and w.contract_id = 1
      and a.work_date = (now() at time zone 'Asia/Singapore')::date
    order by al.channel`, [last4]);
  return rows;
}

async function waitFor(fn, label, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await sleep(200); }
  throw new Error("FAIL: timed out waiting for " + label);
}

(async () => {
  await db.connect();
  await stub("/__reset", {});
  const browser = await chromium.launch();

  // 1. Unwell check-in -> one request per channel, correct auth, name + link, no remarks.
  const w1 = await freshJl111Worker();
  const screen = await checkInUnwell(browser, w1, "SECRET-REMARK fever");
  assert(screen.includes("safety officer has been notified"), "worker told their safety officer was notified");
  await waitFor(async () => (await stub("/__requests")).length >= 3, "3 provider requests");
  const reqs = await stub("/__requests");
  const email = reqs.find((r) => r.path === "/emails");
  const tg = reqs.find((r) => r.path.endsWith("/sendMessage"));
  const wa = reqs.find((r) => r.path.endsWith("/messages"));
  assert(reqs.length === 3 && email && tg && wa, "exactly one email, one Telegram, one WhatsApp request");
  assert(email.auth === "Bearer re_test" && email.body.to[0] === "safety.jl111@example.com", "Resend auth + recipient");
  assert(email.body.subject.includes("JL111") && email.body.html.includes("/site"), "email subject + link");
  assert(tg.path === "/bottg-test/sendMessage" && tg.body.chat_id === "100000001", "Telegram bot token + chat_id");
  assert(wa.path === "/v21.0/wa-phone/messages" && wa.auth === "Bearer wa-test" && wa.body.to === "6590000001", "WhatsApp phone id, auth, number");
  assert(wa.body.type === "template" && wa.body.template.name === "dtbm_unwell", "WhatsApp uses approved template");
  assert(tg.body.text.includes(`…${w1}`) && tg.body.text.includes("reported unwell") && tg.body.text.includes("http://localhost:3000/site"), "message has name, last-4, link");
  assert(!JSON.stringify(reqs).includes("SECRET-REMARK"), "remarks never leave the app");
  await waitFor(async () => (await alertStatuses(w1)).every((r) => r.status === "sent"), "alerts marked sent");
  console.log("ok: all three alerts marked sent");

  // 2. Provider outage -> failed with error; cron retry with right secret resends.
  await stub("/__fail", { on: true });
  const w2 = await freshJl111Worker();
  await checkInUnwell(browser, w2, "outage test");
  await waitFor(async () => { const s = await alertStatuses(w2); return s.length === 3 && s.every((r) => r.status === "failed"); }, "alerts marked failed");
  assert((await alertStatuses(w2))[0].error.includes("HTTP 500"), "failure reason recorded");
  await stub("/__fail", { on: false });
  const bad = await fetch(`${BASE}/api/alerts/dispatch`, { method: "POST", headers: { authorization: "Bearer wrong" } });
  assert(bad.status === 401, "dispatch rejects wrong CRON_SECRET");
  const good = await fetch(`${BASE}/api/alerts/dispatch`, { method: "POST", headers: { authorization: "Bearer test-cron" } });
  const result = await good.json();
  assert(good.status === 200 && result.sent === 3, `cron retry resent failed alerts (${JSON.stringify(result)})`);
  assert((await alertStatuses(w2)).every((r) => r.status === "sent"), "retried alerts now sent");

  // 3. Dashboard badge + Telegram deep-link linking + test alert from settings.
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await p.goto(`${BASE}/login`);
  await p.fill("input[name=email]", "jl111@dtbm.demo");
  await p.fill("input[name=password]", "demo1234");
  await p.click("button:has-text('Log in')");
  await p.waitForURL("**/site");
  assert(await p.locator("tr", { hasText: "outage test" }).locator("text=✓ Sent 3").isVisible(), "dashboard shows ✓ Sent 3 badge");

  await p.goto(`${BASE}/site/settings`);
  assert((await p.locator(".kpi .pill.good").count()) === 3, "all three channels show Live");
  await p.fill("input[name=name]", "Officer via link");
  await p.selectOption("select[name=channel]", "telegram");
  await p.click("button:has-text('Add recipient')");
  await p.waitForSelector("text=open the Telegram link");
  const href = await p.locator("a[href^='https://t.me/dtbm_demo_bot?start=']").getAttribute("href");
  const code = href.split("start=")[1];
  await p.click("button:has-text('Check link')");
  await p.waitForSelector("text=Not linked yet");
  console.log("ok: check link before Start says not linked");
  await stub("/__tg_start", { code, chat_id: 777000111 });
  await p.click("button:has-text('Check link')");
  await p.waitForSelector("text=Telegram linked.");
  assert(await p.isVisible("td:has-text('777000111')"), "Telegram chat linked via deep link");

  await stub("/__reset", {});
  await p.locator("tr", { hasText: "777000111" }).locator("button:has-text('Send test')").click();
  await p.waitForSelector("text=Test alert sent.");
  const t = (await stub("/__requests"))[0];
  assert(t && t.body.chat_id === "777000111" && t.body.text.includes("test alert"), "test alert reached Telegram stub");
  if (process.argv[2]) await p.screenshot({ path: `${process.argv[2]}/settings-live.png`, fullPage: true });

  await browser.close();
  await db.end();
  console.log("ALERTS LIVE-PATH PASSED");
})().catch((e) => { console.error(e.message); process.exit(1); });

/* Example run (fresh seed):
   node tests/stub-providers.js 4010 &
   CRON_SECRET=test-cron RESEND_API_KEY=re_test ALERT_EMAIL_FROM="dTBM <alerts@example.com>" \
   TELEGRAM_BOT_TOKEN=tg-test TELEGRAM_BOT_USERNAME=dtbm_demo_bot \
   WHATSAPP_TOKEN=wa-test WHATSAPP_PHONE_ID=wa-phone WHATSAPP_TEMPLATE=dtbm_unwell \
   RESEND_API_BASE=http://127.0.0.1:4010 TELEGRAM_API_BASE=http://127.0.0.1:4010 \
   WHATSAPP_API_BASE=http://127.0.0.1:4010 npm start &
   node tests/alerts.js
*/
