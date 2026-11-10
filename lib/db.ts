import "server-only";
import { Pool, type PoolClient } from "pg";

const globalForPool = globalThis as unknown as { __dtbmPool?: Pool };

// Hosted Postgres (Supabase pooler) needs TLS. Its pooler certificate chain is not in Node's
// trust store, so DATABASE_SSL=true encrypts without verifying the certificate.
// Serverless: every function instance has its own pool, so keep it small in production.
export const pool =
  globalForPool.__dtbmPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    max: process.env.NODE_ENV === "production" ? 3 : 10,
  });
if (process.env.NODE_ENV !== "production") globalForPool.__dtbmPool = pool;

export type Db = PoolClient;

async function tx<T>(setup: (c: Db) => Promise<void>, fn: (c: Db) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local search_path = dtbm, extensions, public");
    await setup(c);
    const result = await fn(c);
    await c.query("commit");
    return result;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

/** Run queries as a logged-in user. Row-level security decides what they can see. */
export function asUser<T>(userId: string, fn: (c: Db) => Promise<T>): Promise<T> {
  return tx(async (c) => {
    await c.query("select set_config('app.user_id', $1, true)", [userId]);
    await c.query("set local role dtbm_app");
  }, fn);
}

/** Trusted server-side work (login, worker check-in). Callers must scope queries themselves. */
export function asService<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  return tx(async () => {}, fn);
}
