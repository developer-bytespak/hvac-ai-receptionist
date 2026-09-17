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

export type DatabaseMode = "postgres" | "embedded-local" | "embedded-ephemeral";

/**
 * Finds the Postgres connection string whatever the host called it.
 *
 * Vercel's own Postgres sets POSTGRES_URL, its Neon and Supabase marketplace
 * integrations set DATABASE_URL or POSTGRES_PRISMA_URL, and Render sets
 * DATABASE_URL. Accepting all of them removes a step that is easy to get
 * wrong and hard to spot, because the app just silently runs on the wrong
 * store.
 *
 * Pooled URLs come first: serverless opens and drops connections constantly,
 * which is exactly what a pooler is for.
 */
export function connectionString(): string | undefined {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.DATABASE_POSTGRES_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.DATABASE_URL_UNPOOLED,
  ];
  return candidates.find((v) => typeof v === "string" && v.startsWith("postgres"));
}

/** Which variable supplied the connection, for the diagnostics endpoint. */
export function connectionSource(): string | null {
  for (const name of [
    "DATABASE_URL",
    "POSTGRES_URL",
    "POSTGRES_PRISMA_URL",
    "DATABASE_POSTGRES_URL",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL_UNPOOLED",
  ]) {
    const v = process.env[name];
    if (typeof v === "string" && v.startsWith("postgres")) return name;
  }
  return null;
}

function isServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Which store is in use, and whether it is shared between requests.
 *
 * This matters more than it looks. On a serverless host each request can land
 * on a different instance, so the embedded database gives every request its
 * own empty copy: the agent books a job on one instance and the browser polls
 * another, and the board never updates. A demo deployed that way looks broken
 * in the one way that matters. Set DATABASE_URL to a real Postgres.
 */
export function databaseMode(): DatabaseMode {
  if (connectionString()) return "postgres";
  return isServerless() ? "embedded-ephemeral" : "embedded-local";
}

export function databaseWarning(): string | null {
  if (databaseMode() !== "embedded-ephemeral") return null;
  return (
    "No Postgres connection string was found, so this deployment is using the embedded " +
    "database inside a serverless function. State is not shared between requests, so " +
    "bookings will not appear on the board. Attach a Postgres database and redeploy. " +
    "Any of DATABASE_URL, POSTGRES_URL or POSTGRES_PRISMA_URL will be picked up."
  );
}

interface Driver {
  query(sql: string, params?: any[]): Promise<{ rows: Row[] }>;
  /** Runs a script that contains several statements. */
  exec(sql: string): Promise<void>;
}

let driverPromise: Promise<Driver> | null = null;
let schemaReady: Promise<void> | null = null;

async function makeDriver(): Promise<Driver> {
  const url = connectionString();

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

  // Serverless filesystems are read only apart from /tmp, so the embedded
  // database cannot live beside the code there.
  const defaultDir = isServerless() ? "/tmp/pgdata" : "./.pgdata";
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(process.env.PGLITE_DIR || defaultDir);
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
