/**
 * Database access for the demo. Shared with the dental build.
 *
 * Two drivers, one interface:
 *   - DATABASE_URL set   -> real Postgres (Neon on Vercel and Render)
 *   - DATABASE_URL unset -> PGlite, an embedded Postgres, so the demo runs
 *                           locally with no account and no Docker
 *
 * Both speak the same SQL, so the schema and every query are identical.
 */

import { SCHEMA_SQL, TRUNCATE_SQL } from "./schema";

export type Row = Record<string, any>;

interface Driver {
  query(sql: string, params?: any[]): Promise<{ rows: Row[] }>;
  /** Runs a script that contains several statements. */
  exec(sql: string): Promise<void>;
}

let driverPromise: Promise<Driver> | null = null;
let schemaReady: Promise<void> | null = null;

async function makeDriver(): Promise<Driver> {
  const url = process.env.DATABASE_URL;

  if (url) {
    const { Pool } = await import("pg");
    const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
    const pool = new Pool({
      connectionString: url,
      // Neon and Render both terminate TLS in front of Postgres.
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    return {
      query: (sql, params) => pool.query(sql, params),
      // node-postgres runs multi statement scripts in simple query mode.
      exec: async (sql) => {
        await pool.query(sql);
      },
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(process.env.PGLITE_DIR || "./.pgdata");
  // PGlite boots a WebAssembly Postgres. Touching it before that finishes
  // aborts the runtime, which showed up as a 500 on the first request after a
  // cold start and then worked forever after.
  await pg.waitReady;
  return {
    query: async (sql, params) => {
      const result = await pg.query(sql, params);
      return { rows: (result.rows ?? []) as Row[] };
    },
    // PGlite's query() takes a single statement, exec() takes a script.
    exec: async (sql) => {
      await pg.exec(sql);
    },
  };
}

function driver(): Promise<Driver> {
  if (!driverPromise) driverPromise = makeDriver();
  return driverPromise;
}

/**
 * Creates the schema and seeds the practice if it is empty. Safe to call on
 * every request: every statement is idempotent, so a cold serverless function
 * bootstraps itself on first use and there is no deploy step.
 */
export function ready(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const d = await driver();
      await d.exec(SCHEMA_SQL);
      const { rows } = await d.query("select count(*)::int as n from demo_clients");
      if (!rows[0] || rows[0].n === 0) {
        const { seed } = await import("./seed");
        await seed();
      }
    })().catch((err) => {
      // Let the next request retry rather than caching a failure forever.
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

/** Runs a query, bootstrapping the schema first. */
export async function q<T = Row>(sql: string, params: any[] = []): Promise<T[]> {
  await ready();
  const d = await driver();
  const { rows } = await d.query(sql, params);
  return rows as T[];
}

/** Runs a query without the bootstrap check. Used by the seeder itself. */
export async function raw<T = Row>(sql: string, params: any[] = []): Promise<T[]> {
  const d = await driver();
  const { rows } = await d.query(sql, params);
  return rows as T[];
}

/** Convenience for single-row results. */
export async function one<T = Row>(sql: string, params: any[] = []): Promise<T | undefined> {
  const rows = await q<T>(sql, params);
  return rows[0];
}

/** Clears every demo table and reseeds. Backs the "Reset demo" button. */
export async function resetDemo(): Promise<void> {
  await ready();
  const d = await driver();
  await d.exec(TRUNCATE_SQL);
  const { seed } = await import("./seed");
  await seed();
}
