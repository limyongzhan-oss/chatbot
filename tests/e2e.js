// End-to-end walk-through of the dTBM thin slice (needs Playwright + Chromium).
// Usage: npm run db:reset && npm start, then: node tests/e2e.js 042O /tmp/shots
// 042O is a seeded JL111 worker who has no check-in today on a fresh seed.
const { chromium, devices } = require("playwright");
const [last4, out] = process.argv.slice(2);
const BASE = "http://localhost:3000";
const assert = (ok, msg) => { if (!ok) throw new Error("FAIL: " + msg); console.log("ok:", msg); };

(async () => {
  const browser = await chromium.launch();

  // 1. Worker on a phone: wrong PIN, then check in unwell, then check out.
  const phone = await browser.newContext({ ...devices["iPhone 13"] });
  const w = await phone.newPage();
  await w.goto(`${BASE}/checkin/jl111-demo`);
  await w.fill("input[name=last4]", last4);
  await w.fill("input[name=pin]", "9999");
  await w.click("text=Continue");
  await w.waitForSelector(".err", { timeout: 8000 }); assert((await w.textContent(".err")).includes("find you"), "wrong PIN rejected");
  await w.fill("input[name=last4]", last4);
  await w.fill("input[name=pin]", "1234");
  await w.click("text=Continue");
  await w.waitForSelector("text=Check-in type");
  await w.click("label[for=t-mid]");
  await w.click("label[for=h-unwell]");
  await w.fill("textarea[name=remarks]", "Demo: dizzy after lunch");
  await w.screenshot({ path: `${out}/1-worker-checkin.png`, fullPage: true });
  await w.click("text=Check in");
  await w.waitForSelector("text=Checked in at");
  assert(await w.isVisible("text=Mid-day check-in"), "worker checked in as mid, unwell");
  await w.screenshot({ path: `${out}/2-worker-checked-in.png`, fullPage: true });

  // 2. Contractor JL111 sees the worker as unwell and still on site.
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const p = await desk.newPage();
  await p.goto(`${BASE}/login`);
  await p.fill("input[name=email]", "jl111@dtbm.demo");
  await p.fill("input[name=password]", "demo1234");
  await p.click("button:has-text('Log in')");
  await p.waitForURL("**/site");
  const unwellCard = p.locator("section.card", { hasText: "Unwell workers" });
  assert(await unwellCard.locator("text=Demo: dizzy after lunch").isVisible(), "contractor sees unwell worker + remarks");
  const exitCard = p.locator("section.card", { hasText: "Not yet exited" });
  assert((await exitCard.getByText("…" + last4).count()) === 1, "worker in not-yet-exited list");
  await p.screenshot({ path: `${out}/3-contractor-site.png`, fullPage: true });

  // 3. Contractor cannot reach authority pages or other sites.
  await p.goto(`${BASE}/authority/c/CR111`);
  assert(p.url().endsWith("/site"), "contractor redirected away from authority pages");
  assert(!(await p.content()).includes("CR111"), "no CR111 data on contractor page");

  // 4. Worker checks out -> leaves not-exited list.
  await w.click("text=Check out");
  await w.waitForSelector("text=Checked out at");
  await w.screenshot({ path: `${out}/4-worker-checked-out.png`, fullPage: true });
  await p.goto(`${BASE}/site`);
  const exitCard2 = p.locator("section.card", { hasText: "Not yet exited" });
  assert((await exitCard2.getByText("…" + last4).count()) === 0, "checked-out worker left not-exited list");

  // 5. Follow-up toggle.
  const row = p.locator("section.card", { hasText: "Unwell workers" }).locator("tr", { hasText: "Demo: dizzy" });
  await row.locator("button").click();
  await p.waitForLoadState("networkidle");
  assert(await p.locator("tr", { hasText: "Demo: dizzy" }).locator("text=✓ Done").isVisible(), "follow-up marked done");

  // 6. Authority drill-down: overview -> JL -> JL111 shows the same worker.
  const a = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })).newPage();
  await a.goto(`${BASE}/login`);
  await a.fill("input[name=email]", "authority@dtbm.demo");
  await a.fill("input[name=password]", "demo1234");
  await a.click("button:has-text('Log in')");
  await a.waitForURL("**/authority");
  assert(await a.isVisible("text=Sites reporting"), "authority overview loads");
  await a.screenshot({ path: `${out}/5-authority-overview.png`, fullPage: true });
  await a.click("a:has-text('JL')");
  await a.waitForURL("**/authority/g/JL**");
  await a.screenshot({ path: `${out}/6-authority-group.png`, fullPage: true });
  await a.click("a:has-text('JL111')");
  await a.waitForURL("**/authority/c/JL111**");
  assert(await a.isVisible("text=Demo: dizzy after lunch"), "authority sees same unwell worker");
  await a.screenshot({ path: `${out}/7-authority-site.png`, fullPage: true });
  await a.goto(`${BASE}/site`);
  assert(a.url().endsWith("/authority"), "authority redirected from contractor page");

  // 7. Mobile layout: no horizontal scroll on the contractor dashboard.
  const m = await phone.newPage();
  await m.goto(`${BASE}/login`);
  await m.fill("input[name=email]", "jl111@dtbm.demo");
  await m.fill("input[name=password]", "demo1234");
  await m.click("button:has-text('Log in')");
  await m.waitForURL("**/site");
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 0, `no horizontal page scroll on phone (overflow ${overflow}px)`);

  await browser.close();
  console.log("E2E PASSED");
})().catch((e) => { console.error(e.message); process.exit(1); });
