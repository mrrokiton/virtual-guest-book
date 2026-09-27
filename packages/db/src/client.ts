import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
export type Database = PgDatabase<PgQueryResultHKT, Schema>;

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max });
}

export function createDb(pool: pg.Pool): Database {
  return drizzle(pool, { schema }) as unknown as Database;
}
