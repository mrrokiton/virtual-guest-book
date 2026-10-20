import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
export type Database = PgDatabase<PgQueryResultHKT, Schema>;

export function createPool(connectionString: string, max = 10): pg.Pool {
  const pool = new pg.Pool({ connectionString, max });
  // Neon closes idle connections when the compute scales to zero. Without a listener the pool
  // re-emits that as an unhandled 'error' and the process dies; the next query reconnects anyway.
  pool.on('error', (err) => console.warn('[db] idle connection closed:', err.message));
  return pool;
}

export function createDb(pool: pg.Pool): Database {
  return drizzle(pool, { schema }) as unknown as Database;
}
