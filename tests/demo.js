// Browser test for demo/dtbm-demo.html, opened as file:// exactly like a double-click.
// Usage: node tests/demo.js [screenshot-dir]      (needs Playwright + Chromium)
const { chromium, devices } = require("playwright");
const path = require("node:path");
const url = "file://" + path.resolve(__dirname, "../demo/dtbm-demo.html").replace(/\\/g, "/");
const shots = process.argv[2];
const assert = (ok, msg) => { if (!ok) throw new Error("FAIL: " + msg); console.log("ok:", msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (p, name) => (shots ? p.screenshot({ path: `${shots}/${name}.png`, fullPage: true }) : null);

const kpi = (p, label) => p.locator(".kpi", { has: p.locator(".label", { hasText: new RegExp("^" + label + "$") }) }).locator(".value");
const num = async (p, label) => Number(await kpi(p, label).textContent());
const card = (p, title) => p.locator("section.card", { has: p.locator("h2", { hasText: title }) });
async function waitUntil(fn, label, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await sleep(150); }
  throw new Error("FAIL: timed out waiting for " + label);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // 1. Self-contained: nothing is requested except the file itself; no script errors.
  const outside = [], errors = [];
  ctx.on("request", (r) => { if (!r.url().startsWith("file://") && !r.url().startsWith("data:")) outside.push(r.url()); });
  const A = await ctx.newPage();
  A.on("pageerror", (e) => errors.push(e.message));
  A.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await A.goto(url);
  assert(await A.isVisible("text=DEMO · fictional data"), "demo banner shown on login screen");
  await shot(A, "demo-1-login");

  // 2. Contractor JL111 sees only JL111.
  await A.selectOption("#cpick", "JL111");
  await A.click("button:has-text('Enter as contractor')");
  await A.waitForSelector("h1:has-text('JL111')");
  const body = await A.innerText("body");
  assert(!/CR1\d\d/.test(body), "contractor page contains no CR site data");
  const before = { in: await num(A, "Checked in"), on: await num(A, "Still on site"), unwell: await num(A, "Unwell") };
  assert(before.in > 150 && before.unwell >= 0, `JL111 headcount looks realistic (${before.in} in, ${before.unwell} unwell)`);
  const unwellNames = async (p) => (await card(p, "Unwell workers").locator("tbody tr td:first-child").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).sort();
  const contractorUnwell = await unwellNames(A);
  await shot(A, "demo-2-contractor");

  // 3. Authority drills JL -> JL111; same unwell workers; audit log written.
  const B = await ctx.newPage();
  B.on("pageerror", (e) => errors.push(e.message));
  await B.goto(url);
  await B.click("button:has-text('Enter as authority')");
  await B.waitForSelector("text=Manpower overview");
  assert((await B.locator(".kpi .label", { hasText: "Sites reporting" }).count()) === 1, "authority overview loads");
  await shot(B, "demo-3-authority");
  await B.click("a:has-text('JL') >> nth=0");
  await B.waitForSelector("h1:has-text('JL — Jade Line')");
  await B.click("a:has-text('JL111')");
  await B.waitForSelector("h1:has-text('JL111')");
  assert(JSON.stringify(await unwellNames(B)) === JSON.stringify(contractorUnwell), "authority sees the same unwell workers as the contractor");
  await shot(B, "demo-4-authority-site");
  await B.click("text=View audit log");
  await B.waitForSelector("td:has-text('view_site_names')");
  console.log("ok: audit log records the authority's view of worker names");

  // 4. Role guards.
  await A.evaluate(() => { location.hash = "#/authority/c/CR111"; });
  await A.waitForSelector("h1:has-text('JL111')");
  assert(A.url().endsWith("#/site"), "contractor sent back from authority page");
  assert(!(await A.innerText("body")).includes("CR111"), "no CR111 data after the attempt");
  await B.evaluate(() => { location.hash = "#/site"; });
  await B.waitForSelector("text=Manpower overview");
  assert(B.url().endsWith("#/authority"), "authority sent back from contractor page");

  // 5. Worker phone view: PIN lockout, then a real check-in.
  const C = await ctx.newPage();
  C.on("pageerror", (e) => errors.push(e.message));
  await C.goto(url + "#/checkin/jl111-demo");
  const chips = await C.locator(".chip").evaluateAll((els) => els.map((e) => e.getAttribute("data-v")));
  assert(chips.length === 3, "worker view suggests 3 workers not yet checked in");
  const identify = async (last4, pin) => {
    await C.goto(url + "#/checkin/jl111-demo");
    await C.reload();
    await C.fill("#last4", last4);
    await C.fill("input[name=pin]", pin);
    await C.click("button:has-text('Continue')");
  };
  for (let i = 1; i <= 5; i++) { await identify(chips[0], "000" + i); await C.waitForSelector(".err:has-text('find you')"); }
  await identify(chips[0], "1234");
  await C.waitForSelector(".err:has-text('Too many wrong PINs')");
  console.log("ok: 6th attempt with the CORRECT pin is locked out");

  await identify(chips[1], "1234");
  await C.waitForSelector("text=Check-in type");
  await shot(C, "demo-5-worker-checkin");
  await C.click("label[for=t-mid]");
  await C.click("label[for=h-unwell]");
  await C.fill("textarea[name=remarks]", "SECRET-REMARK fever");
  if (await C.locator("input[name=consent]").count()) await C.check("input[name=consent]");

  // 6. Cross-tab: tab A (contractor dashboard) updates by itself when the worker checks in.
  await A.bringToFront();
  await C.click("button:has-text('Check in')");
  await C.waitForSelector("h2:has-text('Checked in at')");
  assert(await C.isVisible("text=safety officer has been notified"), "worker told the safety officer was notified");
  assert((await C.locator(".pv.email").count()) === 1 && (await C.locator(".pv.tg").count()) === 1 && (await C.locator(".pv.wa").count()) === 1, "email, Telegram and WhatsApp previews shown");
  const pvText = await C.locator(".sideinfo").innerText();
  assert(pvText.includes("…" + chips[1]) && pvText.includes("dtbm.example/site") && pvText.includes("reported unwell"), "preview has name, last 4 and link");
  assert(!pvText.includes("SECRET-REMARK"), "remarks are not in the alert previews");
  const stored = await C.evaluate(() => JSON.parse(localStorage.getItem("dtbm-demo-v1")));
  assert(stored.alerts.length === 3 && stored.alerts.every((a) => !a.body.includes("SECRET-REMARK")), "stored alerts never contain the remarks");
  await shot(C, "demo-6-worker-alerts");

  await waitUntil(async () => (await num(A, "Checked in")) === before.in + 1, "dashboard A to update by itself");
  assert((await num(A, "Unwell")) === before.unwell + 1 && (await num(A, "Still on site")) === before.on + 1, "dashboard A updated by itself (checked in, unwell, on site)");
  assert((await card(A, "Unwell workers").innerText()).includes("SECRET-REMARK fever"), "contractor sees the worker's remarks");
  assert((await card(A, "Not yet exited").innerText()).includes("…" + chips[1]), "worker listed in 'Not yet exited'");

  // 7. Check out -> leaves the not-exited list on tab A.
  await C.click("button:has-text('Check out')");
  await C.waitForSelector("h2:has-text('Checked out at')");
  await waitUntil(async () => (await num(A, "Still on site")) === before.on, "dashboard A to show the checkout");
  assert(!(await card(A, "Not yet exited").innerText()).includes("…" + chips[1]), "checked-out worker left 'Not yet exited'");

  // 8. Follow-up toggle + alert badge.
  const row = card(A, "Unwell workers").locator("tr", { hasText: "SECRET-REMARK fever" });
  assert((await row.locator(".pill", { hasText: "Demo 3" }).count()) === 1, "unwell row shows Demo 3 alert badge");
  await row.locator("button:has-text('Mark done')").click();
  await waitUntil(async () => (await card(A, "Unwell workers").locator("tr", { hasText: "SECRET-REMARK fever" }).locator("text=✓ Done").count()) === 1, "follow-up marked done");

  // 9. Alert settings: log + test alert.
  await A.click("a:has-text('Alert settings')");
  await A.waitForSelector("h1:has-text('Unwell alerts')");
  const logRows = await card(A, "Alert log").locator("tbody tr").count();
  assert(logRows === 3, "alert log has the 3 alerts from the check-in");
  await A.locator("tr", { hasText: "Telegram" }).first().locator("button:has-text('Send test')").click();
  await A.waitForSelector("text=Test alert recorded");
  assert((await card(A, "Alert log").locator("tbody tr").count()) === 4, "test alert added to the log (one channel)");
  await shot(A, "demo-7-alert-settings");

  // 10. Reset restores the original numbers.
  await A.click("a:has-text('JL111 dashboard')");
  await A.waitForSelector("h1:has-text('JL111')");
  await A.click("button:has-text('Reset demo data')");
  await waitUntil(async () => (await num(A, "Checked in")) === before.in, "reset to original numbers");
  assert((await num(A, "Unwell")) === before.unwell && (await num(A, "Still on site")) === before.on, "reset restores the original numbers");

  // 11. Nothing left the file, nothing threw.
  assert(outside.length === 0, "no network requests besides the file itself" + (outside.length ? " (" + outside.slice(0, 3) + ")" : ""));
  assert(errors.length === 0, "no script errors" + (errors.length ? " (" + errors[0] + ")" : ""));

  // 12. Phone width: no sideways scrolling.
  const phone = await browser.newContext({ ...devices["iPhone 13"] });
  const M = await phone.newPage();
  await M.goto(url);
  const overflow = async () => M.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert((await overflow()) <= 0, "login screen fits a phone");
  await M.click("button:has-text('Enter as contractor')");
  await M.waitForSelector("h1:has-text('JL111')");
  assert((await overflow()) <= 0, `contractor dashboard fits a phone (overflow ${await overflow()}px)`);
  await M.goto(url + "#/checkin/jl111-demo");
  await M.reload();
  assert((await overflow()) <= 0, "worker check-in fits a phone");
  await shot(M, "demo-8-phone-worker");

  await browser.close();
  console.log("DEMO PASSED");
})().catch((e) => { console.error(e.message); process.exit(1); });
