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
const num = async (p, label) => Number((await kpi(p, label).textContent()).replace(/,/g, ""));
const card = (p, title) => p.locator("section.card", { has: p.locator("h2", { hasText: title }) });
async function waitUntil(fn, label, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await sleep(150); }
  throw new Error("FAIL: timed out waiting for " + label);
}
const today = new Date().toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const outside = [], errors = [];
  ctx.on("request", (r) => { if (!r.url().startsWith("file://") && !r.url().startsWith("data:")) outside.push(r.url()); });
  const watch = (p) => { p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); }); return p; };

  /* ---- 1. Login screen: new name, LTA / contractor entries, nothing old ---- */
  const A = watch(await ctx.newPage());
  await A.goto(url);
  assert((await A.title()) === "Site manpower and worker health declaration", "page title is the new name");
  assert(await A.isVisible("h1:has-text('Site manpower and worker health declaration')"), "login heading is the new name");
  assert(await A.isVisible("button:has-text('Enter as LTA')"), "authority button reads 'Enter as LTA'");
  assert(await A.isVisible("button:has-text('Enter as contractor')"), "contractor button present");
  let body = await A.innerText("body");
  assert(!/sees one site only/i.test(body), "'sees one site only' text is gone");
  assert(!/dTBM/.test(body) && !/\bJL\d|\bCR\d/.test(body), "no old name or old site codes on the login screen");
  await shot(A, "demo-1-login");

  /* ---- 2. LTA log-in with dummy credentials ---- */
  const B = watch(await ctx.newPage());
  await B.goto(url);
  await B.click("button:has-text('Enter as LTA')");
  await B.waitForSelector("text=Dummy credentials");
  assert(await B.isVisible("code:has-text('lta.officer')"), "LTA dummy credentials are shown");
  await shot(B, "demo-2-lta-login");
  await B.fill("input[name=pass]", "wrong");
  await B.click("button:has-text('Log in')");
  await B.waitForSelector(".err:has-text('Wrong username or password')");
  await B.fill("input[name=pass]", "lta-demo-123");
  await B.click("button:has-text('Log in')");
  await B.waitForSelector("text=Manpower overview");
  body = await B.innerText("body");
  assert(body.includes("Jurong Region Line") && body.includes("Cross Island Line"), "lines are named Jurong Region Line and Cross Island Line");
  assert(!/\bJL\d|\bCR\d|\bJL\b|\bCR\b/.test(body), "no old JL / CR codes on the LTA overview");
  assert(await B.isVisible(".topbar:has-text('LTA')"), "top bar says LTA");
  await shot(B, "demo-3-lta-overview");

  /* ---- 3. Contractor log-in; own site only; no roster ---- */
  const logged = watch(await ctx.newPage());
  await logged.goto(url);
  await logged.click("button:has-text('Enter as contractor')");
  await logged.waitForSelector("text=Dummy credentials");
  assert((await logged.locator(".cred tbody tr").count()) === 6, "six dummy contractor credentials listed");
  await logged.fill("input[name=pass]", "nope");
  await logged.click("button:has-text('Log in')");
  await logged.waitForSelector(".err:has-text('Wrong username or password')");
  await logged.close();

  await A.click("button:has-text('Enter as contractor')");
  await A.waitForSelector("text=Dummy credentials");
  await shot(A, "demo-4-contractor-login");
  await A.click("button:has-text('Log in')");
  await A.waitForSelector("h1:has-text('Meridian Civil Pte Ltd')");
  body = await A.innerText("body");
  assert(body.includes("JRL111 · JRL Station A"), "site is named 'JRL Station A' in standard format");
  assert(!/roster/i.test(body), "no roster numbers on the contractor page");
  assert(!/CRL1\d\d/.test(body), "contractor page contains no CRL site data");
  const subNames = (await card(A, "Manpower by subcontractor").locator("tbody tr td:first-child").allInnerTexts()).map((t) => t.split("\n")[0].trim()).filter((t) => t && t !== "Total");
  assert(subNames.length >= 3 && subNames.length <= 5, `JRL111 has ${subNames.length} subcontractors`);
  const before = { in: await num(A, "Checked in"), on: await num(A, "Still on site"), unwell: await num(A, "Unwell"), inj: await num(A, "Injury / clinic") };
  await shot(A, "demo-5-contractor-day");

  /* ---- 4. Daily / monthly switch ---- */
  await A.click(".seg a:has-text('Monthly')");
  await A.waitForSelector(".kpi .label:has-text('Man-days')");
  const monthBefore = await num(A, "Man-days");
  assert(monthBefore >= before.in && (await num(A, "Average per day")) > 0, "monthly view shows man-days and average per day");
  assert(!/roster/i.test(await A.innerText("body")), "no roster numbers in the monthly view");
  await shot(A, "demo-6-contractor-month");
  await A.click(".seg a:has-text('Daily')");
  await A.waitForSelector(".kpi .label:has-text('Checked in')");
  assert((await num(A, "Checked in")) === before.in, "switching back to daily shows the same day");

  /* ---- 5. Back buttons (contractor + LTA) ---- */
  await A.click("a:has-text('Alert settings')");
  await A.waitForSelector("h1:has-text('Health declaration alerts')");
  await A.click("a.btn:has-text('← Back')");
  await A.waitForSelector("h1:has-text('Meridian Civil Pte Ltd')");
  console.log("ok: contractor Back returns from alert settings to the dashboard");

  await B.locator("tbody a", { hasText: /^JRL$/ }).click();
  await B.waitForSelector("h1:has-text('JRL — Jurong Region Line')");
  await B.locator("tbody a", { hasText: "JRL111" }).click();
  await B.waitForSelector("h1:has-text('Meridian Civil Pte Ltd')");
  body = await B.innerText("body");
  assert(!/roster/i.test(body), "no roster numbers when LTA views an individual contractor");
  assert(await B.isVisible(".seg a:has-text('Monthly')"), "LTA's contractor view also has Daily / Monthly");
  await shot(B, "demo-7-lta-contractor");
  await B.click("a.btn:has-text('← Back')");
  await B.waitForSelector("h1:has-text('JRL — Jurong Region Line')");
  await B.click("a.btn:has-text('← Back')");
  await B.waitForSelector("text=Manpower overview");
  console.log("ok: LTA Back goes contractor -> line -> overview");
  await B.locator("tbody a", { hasText: /^JRL$/ }).click();
  await B.locator("tbody a", { hasText: "JRL111" }).click();
  await B.click("text=View audit log");
  await B.waitForSelector("td:has-text('view_site_names')");
  await B.click("a.btn:has-text('← Back')");
  await B.waitForSelector("text=Manpower overview");
  console.log("ok: audit log written for the LTA's view of worker names; Back works from it");

  /* ---- 6. Role guards ---- */
  await A.evaluate(() => { location.hash = "#/authority/c/CRL111"; });
  await A.waitForSelector("h1:has-text('Meridian Civil Pte Ltd')");
  assert(A.url().endsWith("#/site") && !/CRL111/.test(await A.innerText("body")), "contractor kept out of LTA pages and other sites");
  await B.evaluate(() => { location.hash = "#/site"; });
  await B.waitForSelector("text=Manpower overview");
  assert(B.url().endsWith("#/authority"), "LTA kept out of the contractor page");

  /* ---- 7. Worker form: header, fields, conditional questions ---- */
  const C = watch(await ctx.newPage());
  await C.goto(url + "#/checkin/jrl111-demo");
  assert((await C.locator("h1").textContent()) === "Meridian Civil Pte Ltd", "worker header shows just the main contractor name");
  const wbody = await C.innerText("body");
  assert(wbody.includes("Date: " + today), `worker form shows today's date (${today})`);
  assert(!/JRL111|JRL Station/.test(wbody) && !/roster/i.test(wbody), "worker form shows no site code and no roster");
  const subOptions = (await C.locator("select[name=subcon] option").allInnerTexts()).slice(1);
  assert(JSON.stringify(subOptions.slice().sort()) === JSON.stringify(subNames.slice().sort()), "subcontractor dropdown lists only this main contractor's subcontractors");
  assert(await C.isDisabled("[data-submit]"), "Check in is disabled until the declaration is ticked");
  assert((await C.locator("input[name=declare]").count()) === 1, "declaration has a single answer: Yes");
  const vis = (sel) => C.locator(sel).isVisible();
  assert(!(await vis("textarea[name=health_note]")) && !(await vis("textarea[name=clinic_note]")) && !(await vis("textarea[name=injury_note]")), "explanation boxes hidden at first");
  await C.click("label[for=d-worker]");
  assert((await vis("input[name=supervisor]")) && !(await vis("input[name=tb_no]")), "Worker -> Supervisor's Name shown, toolbox fields hidden");
  await C.click("label[for=d-sup]");
  assert(!(await vis("input[name=supervisor]")) && (await vis("input[name=tb_no]")) && (await vis("input[name=tb_att]")) && (await vis("input[name=tb_nature]")) && (await vis("input[name=tb_subject]")) && (await vis("textarea[name=tb_items]")), "Supervisor -> five toolbox fields shown, Supervisor's Name hidden");
  await C.click("label[for=health-no]");
  assert(await vis("textarea[name=health_note]"), "health 'No' asks for an explanation");
  await C.click("label[for=health-yes]");
  assert(!(await vis("textarea[name=health_note]")), "health 'Yes' hides the explanation");
  await C.click("label[for=clinic-no]");
  assert(!(await vis("textarea[name=clinic_note]")), "clinic 'No' asks nothing");
  await C.click("label[for=clinic-yes]");
  assert(await vis("textarea[name=clinic_note]"), "clinic 'Yes' asks which doctor/clinic and why");
  await C.click("label[for=injury-yes]");
  assert(await vis("textarea[name=injury_note]"), "injury 'Yes' asks which site and what injury");
  await shot(C, "demo-8-worker-form");
  await C.click("label[for=decl]");
  assert(await C.isEnabled("[data-submit]"), "ticking the declaration enables Check in");
  await C.click("[data-submit]");
  await C.waitForSelector("#formerr .err:has-text('Please enter your name')");
  console.log("ok: empty form is refused with a clear message");

  /* ---- 8. Site PIN: lockout on the check-out tab, then contractor changes the PIN ---- */
  const pin0 = await C.locator("#demopin").textContent();
  assert(/^\d{4}$/.test(pin0) && (await A.locator("#sitepin").textContent()) === pin0, "contractor dashboard and worker help show the same site PIN");
  await C.goto(url + "#/checkin/jrl111-demo/out");
  await C.reload();
  const tryOut = async (pin) => {
    await C.fill("input[name=name]", "Nobody Here"); await C.fill("#last4", "999Z"); await C.fill("input[name=pin]", pin);
    await C.click("button:has-text('Check out')");
  };
  const wrongPin = pin0 === "0000" ? "1111" : "0000";
  for (let i = 0; i < 5; i++) { await tryOut(wrongPin); await C.waitForSelector("#formerr .err:has-text('not right for this site')"); }
  await tryOut(pin0);
  await C.waitForSelector("#formerr .err:has-text('Too many wrong PINs')");
  console.log("ok: 6th attempt with the CORRECT PIN is locked out");
  await A.fill("input[name=pin]", "7777");
  await A.click("button:has-text('Set PIN')");
  await waitUntil(async () => (await A.locator("#sitepin").textContent()) === "7777", "site PIN to change");
  console.log("ok: contractor sets a new site PIN (and the lockout is cleared)");

  /* ---- 9. Worker checks in: Worker designation, unwell + injury ---- */
  await C.goto(url + "#/checkin/jrl111-demo");
  await C.reload();
  assert((await C.locator("#demopin").textContent()) === "7777", "worker help shows the new PIN");
  await C.click("button:has-text('Fill example worker')");
  assert((await C.inputValue("input[name=name]")) === "Demo Worker" && (await C.inputValue("input[name=pin]")) === "7777", "example worker fills name, last 4 and site PIN");
  await C.click("label[for=t-mid]");
  await C.selectOption("select[name=subcon]", { index: 1 });
  await C.click("label[for=newsite-yes]");
  await C.click("label[for=d-worker]");
  await C.fill("input[name=supervisor]", "Mr Lim Boon Kiat");
  await C.click("label[for=health-no]");
  await C.fill("textarea[name=health_note]", "SECRET-HEALTH dizzy since morning");
  await C.click("label[for=clinic-no]");
  await C.click("label[for=injury-yes]");
  await C.fill("textarea[name=injury_note]", "SECRET-INJURY Station B, cut on hand");
  await C.fill("input[name=pin]", wrongPin);
  await C.click("label[for=decl]");
  await C.click("[data-submit]");
  await C.waitForSelector("#formerr .err:has-text('not right for this site')");
  console.log("ok: wrong site PIN refused, and the typed answers are kept");
  await C.fill("input[name=pin]", "7777");
  await A.bringToFront();
  await C.click("[data-submit]");
  await C.waitForSelector("h2:has-text('Checked in at')");
  assert((await C.innerText("body")).includes("Date: " + today) || (await C.innerText("body")).includes(today), "confirmation shows today's date");
  assert((await C.locator(".pv.email").count()) === 1 && (await C.locator(".pv.tg").count()) === 1 && (await C.locator(".pv.wa").count()) === 1, "email, Telegram and WhatsApp previews shown");
  const stored = await C.evaluate(() => JSON.parse(localStorage.getItem("dtbm-demo-v2")));
  assert(stored.alerts.length === 3 && /Demo Worker \(…123A, .+\) reported unwell and reported an injury at \d\d:\d\d\. Details: /.test(stored.alerts[0].body), "alert names the worker, last 4 and both reasons");
  assert(stored.alerts.every((a) => !/SECRET/.test(a.body)), "explanations never appear in alerts");
  assert(stored.checkins[0].name === "Demo Worker" && stored.checkins[0].supervisor === "Mr Lim Boon Kiat" && stored.checkins[0].newToSite === true, "name, supervisor and 'new to site' kept on the day's record");
  await shot(C, "demo-9-worker-alerts");

  /* ---- 10. Dashboard A updates by itself ---- */
  await waitUntil(async () => (await num(A, "Checked in")) === before.in + 1, "dashboard A to update by itself");
  assert((await num(A, "Unwell")) === before.unwell + 1 && (await num(A, "Injury / clinic")) === before.inj + 1 && (await num(A, "Still on site")) === before.on + 1, "dashboard A counts updated (in, unwell, injury, on site)");
  assert((await card(A, "Unwell workers").innerText()).includes("SECRET-HEALTH"), "contractor sees the worker's health explanation");
  assert((await card(A, "Injury / clinic reports").innerText()).includes("SECRET-INJURY"), "contractor sees the injury details");
  assert((await card(A, "Unwell workers").innerText()).includes("New to site"), "'New to site' flag shown");
  assert((await card(A, "Not yet exited").innerText()).includes("…123A"), "worker listed in 'Not yet exited'");
  await shot(A, "demo-10-contractor-after");

  /* ---- 11. Duplicate + supervisor with toolbox meeting ---- */
  await C.click("button:has-text('Done · Next worker')");
  await C.waitForSelector("form[data-form=checkin]");
  const fillBasics = async (name, last4, desig) => {
    await C.fill("input[name=name]", name); await C.fill("#last4", last4); await C.fill("input[name=pin]", "7777");
    await C.selectOption("select[name=subcon]", { index: 2 }); await C.click("label[for=newsite-no]"); await C.click(desig);
    await C.click("label[for=health-yes]"); await C.click("label[for=clinic-no]"); await C.click("label[for=injury-no]"); await C.click("label[for=decl]");
  };
  await fillBasics("Demo Worker", "123A", "label[for=d-worker]");
  await C.fill("input[name=supervisor]", "Someone");
  await C.click("[data-submit]");
  await C.waitForSelector("#formerr .err:has-text('already checked in')");
  console.log("ok: same name + NRIC/FIN last 4 cannot check in twice in a day");
  await C.goto(url + "#/checkin/jrl111-demo"); await C.reload();
  await fillBasics("Sup Visor", "456B", "label[for=d-sup]");
  await C.fill("input[name=tb_no]", "twelve"); await C.fill("input[name=tb_att]", "25");
  await C.fill("input[name=tb_nature]", "Rebar fixing"); await C.fill("input[name=tb_subject]", "Working at height"); await C.fill("textarea[name=tb_items]", "Harness checks");
  await C.click("[data-submit]");
  await C.waitForSelector("#formerr .err:has-text('must be a whole number')");
  await C.fill("input[name=tb_no]", "12");
  await C.click("[data-submit]");
  await C.waitForSelector("h2:has-text('Checked in at')");
  console.log("ok: supervisor checked in with toolbox details (integers validated)");
  await waitUntil(async () => (await num(A, "Checked in")) === before.in + 2, "dashboard A to show the supervisor");
  const tb = await card(A, "Toolbox meetings").innerText();
  assert(tb.includes("Sup Visor") && tb.includes("Working at height") && tb.includes("Harness checks") && /\b12\b/.test(tb) && /\b25\b/.test(tb), "toolbox meeting shown on the contractor dashboard");
  assert((await num(A, "Unwell")) === before.unwell + 1, "a healthy supervisor adds no unwell case");

  /* ---- 12. Check-out tab ---- */
  await C.click("button:has-text('Done · Next worker')");
  await C.goto(url + "#/checkin/jrl111-demo/out"); await C.reload();
  await C.fill("input[name=name]", "demo worker"); await C.fill("#last4", "123a"); await C.fill("input[name=pin]", "7777");
  await C.click("button:has-text('Check out')");
  await C.waitForSelector("h2:has-text('Checked out at')");
  await waitUntil(async () => (await num(A, "Still on site")) === before.on + 1, "dashboard A to show the check-out");
  assert(!(await card(A, "Not yet exited").innerText()).includes("…123A"), "checked-out worker left 'Not yet exited'");

  /* ---- 13. Follow-up, monthly totals, reset ---- */
  const row = card(A, "Unwell workers").locator("tr", { hasText: "SECRET-HEALTH" });
  await row.locator("button:has-text('Mark done')").click();
  await waitUntil(async () => (await card(A, "Unwell workers").locator("tr", { hasText: "SECRET-HEALTH" }).locator("text=✓ Done").count()) === 1, "follow-up marked done");
  await A.click(".seg a:has-text('Monthly')");
  await A.waitForSelector(".kpi .label:has-text('Man-days')");
  assert((await num(A, "Man-days")) === monthBefore + 2, "monthly man-days include the two new check-ins");
  assert((await card(A, "Unwell cases").innerText()).includes("SECRET-HEALTH"), "monthly view lists the unwell case");
  await A.click(".seg a:has-text('Daily')");
  await A.waitForSelector(".kpi .label:has-text('Checked in')");
  await A.click("button:has-text('Reset demo data')");
  await waitUntil(async () => (await num(A, "Checked in")) === before.in, "reset to original numbers");
  assert((await num(A, "Unwell")) === before.unwell && (await num(A, "Injury / clinic")) === before.inj, "reset restores the original numbers");
  await A.click("button:has-text('← Back')");
  await A.waitForSelector("button:has-text('Enter as LTA')");
  console.log("ok: Back on the contractor home returns to the login screen");

  assert(outside.length === 0, "no network requests besides the file itself" + (outside.length ? " (" + outside.slice(0, 3) + ")" : ""));
  assert(errors.length === 0, "no script errors" + (errors.length ? " (" + errors[0] + ")" : ""));

  /* ---- 14. Phone width ---- */
  const phone = await browser.newContext({ ...devices["iPhone 13"] });
  const M = await phone.newPage();
  const overflow = () => M.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await M.goto(url);
  assert((await overflow()) <= 0, "login screen fits a phone");
  await M.click("button:has-text('Enter as contractor')");
  assert((await overflow()) <= 0, "contractor log-in fits a phone");
  await M.click("button:has-text('Log in')");
  await M.waitForSelector("h1:has-text('Meridian Civil Pte Ltd')");
  assert((await overflow()) <= 0, `contractor dashboard fits a phone (overflow ${await overflow()}px)`);
  await M.click(".seg a:has-text('Monthly')");
  await M.waitForSelector(".kpi .label:has-text('Man-days')");
  assert((await overflow()) <= 0, "monthly view fits a phone");
  await M.goto(url + "#/checkin/jrl111-demo"); await M.reload();
  await M.click("label[for=d-sup]"); await M.click("label[for=health-no]"); await M.click("label[for=clinic-yes]"); await M.click("label[for=injury-yes]");
  assert((await overflow()) <= 0, "worker form with every question open fits a phone");
  await shot(M, "demo-11-phone-worker");

  await browser.close();
  console.log("DEMO PASSED");
})().catch((e) => { console.error(e.message); process.exit(1); });
