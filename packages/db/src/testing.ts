import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Database } from './client';
import { MIGRATIONS_FOLDER } from './migrate';
import * as schema from './schema';

/** In-process Postgres with all migrations applied; each call is a fresh, isolated database. */
export async function createTestDb(): Promise<{ db: Database; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db: db as unknown as Database, close: () => client.close() };
}

let userSeq = 0;

export async function insertTestUser(db: Database, email?: string) {
  userSeq += 1;
  const id = `user_${userSeq}_${Math.random().toString(36).slice(2, 8)}`;
  const [row] = await db
    .insert(schema.user)
    .values({
      id,
      name: `Test ${userSeq}`,
      email: email ?? `${id}@example.test`,
      emailVerified: true,
    })
    .returning();
  return row!;
}
