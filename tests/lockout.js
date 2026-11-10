// PIN lockout test (needs Playwright + Chromium). Run against the app on :3000 and a seeded DB:
//   DATABASE_URL=... node tests/lockout.js
const { chromium } = require("playwright");
const { Client } = require("pg");

const BASE = "http://localhost:3000";
const db = new Client({ connectionString: process.env.DATABASE_URL });
const assert = (ok, msg) => { if (!ok) throw new Error("FAIL: " + msg); console.log("ok:", msg); };

(async () => {
  await db.connect();
  // Two JL112 workers with no check-in today, so signing in lands on the check-in form.
  const { rows } = await db.query(`
    select w.id_last4 from dtbm.workers w join dtbm.contracts c on c.id = w.contract_id
    where c.code = 'JL112' and not exists (
      select 1 from dtbm.attendance a where a.worker_id = w.id
        and a.work_date = (now() at time zone 'Asia/Singapore')::date)
    order by w.id limit 2`);
  const last4 = rows[0].id_last4;
  await db.query("delete from dtbm.checkin_attempts");

  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const attempt = async (pin) => {
    await page.goto(`${BASE}/checkin/jl112-demo`);
    await page.fill("input[name=last4]", last4);
    await page.fill("input[name=pin]", pin);
    await page.click("text=Continue");
    await page.waitForLoadState("networkidle");
    return (await page.textContent("main")).replace(/\s+/g, " ");
  };

  for (let i = 1; i <= 5; i++) {
    const text = await attempt("000" + i);
    assert(text.includes("couldn't find you"), `wrong PIN ${i} rejected normally`);
  }
  let text = await attempt("1234");
  assert(text.includes("Too many wrong PINs"), "6th attempt with the CORRECT pin is locked out");
  assert(!text.includes("Check-in type"), "locked worker does not reach the check-in form");

  // Another worker on the same site is unaffected.
  await page.goto(`${BASE}/checkin/jl112-demo`);
  await page.fill("input[name=last4]", rows[1].id_last4);
  await page.fill("input[name=pin]", "1234");
  await page.click("text=Continue");
  await page.waitForSelector("text=Check-in type");
  console.log("ok: a different worker can still sign in");

  // Window expiry: age the failures by 16 minutes, correct PIN works and clears the counter.
  await page.context().clearCookies();
  await db.query("update dtbm.checkin_attempts set at = at - interval '16 minutes'");
  text = await attempt("1234");
  assert(text.includes("Check-in type"), "after the 15-minute window the correct PIN works");
  const left = await db.query("select count(*)::int n from dtbm.checkin_attempts where id_last4 = $1", [last4]);
  assert(left.rows[0].n === 0, "successful sign-in clears old failures");

  await browser.close();
  await db.end();
  console.log("LOCKOUT PASSED");
})().catch((e) => { console.error(e.message); process.exit(1); });
