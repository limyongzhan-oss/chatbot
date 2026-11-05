// Rebuilds the dTBM schema and loads demo data. Plain Node (uses the `pg` package), so it runs
// the same in PowerShell, CMD, macOS and Linux, with no psql needed.
// DESTRUCTIVE: schema.sql drops the dtbm schema. Refuses a non-local database unless ALLOW_RESET=1.
//   Local:   npm run db:reset
//   Hosted:  set DATABASE_URL, DATABASE_SSL=true, ALLOW_RESET=1 (and DEMO_PASSWORD), then npm run db:deploy
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const url = process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL first."); process.exit(1); }

if ((url.match(/@/g) || []).length > 1) {
  console.error("DATABASE_URL has more than one '@'. A special character in your password must be URL-encoded");
  console.error("(for example @ becomes %40, # becomes %23, / becomes %2F), or pick a password with letters and digits only.");
  process.exit(1);
}

let host;
try { host = new URL(url).hostname; } catch {
  console.error("DATABASE_URL is not a valid URL. If your password has special characters (@ : / # ?), URL-encode them.");
  process.exit(1);
}
const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
if (!local && process.env.ALLOW_RESET !== "1") {
  console.error(`Refusing to reset '${host}': this deletes all dTBM data there.`);
  console.error("If that is what you want, set ALLOW_RESET=1 and run again.");
  process.exit(1);
}

const sql = (f) => fs.readFileSync(path.join(__dirname, "..", "db", f), "utf8");
const literal = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const demoPassword = process.env.DEMO_PASSWORD || "demo1234";

(async () => {
  const client = new Client({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    // Each file is sent as one multi-statement query, so it runs as a single transaction:
    // a failure leaves the database as it was.
    console.log("Creating schema...");
    await client.query(sql("schema.sql"));
    console.log("Loading demo data (about 30 seconds on a hosted database)...");
    await client.query(sql("seed.sql").replaceAll(":'demo_password'", literal(demoPassword)));
    console.log(`dTBM database ready on '${host}'.`);
  } catch (e) {
    console.error("Failed:", e.message);
    if (e.position) console.error("(position " + e.position + ")");
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
