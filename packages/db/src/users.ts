import { eq, sql } from 'drizzle-orm';
import type { Database } from './client';
import { user } from './schema';

export type User = typeof user.$inferSelect;

export async function findUserByEmail(db: Database, email: string): Promise<User | null> {
  const [row] = await db.select().from(user).where(eq(user.email, email.toLowerCase())).limit(1);
  return row ?? null;
}

export async function markEmailVerified(db: Database, userId: string): Promise<void> {
  await db.update(user).set({ emailVerified: true }).where(eq(user.id, userId));
}

export async function pingDatabase(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
