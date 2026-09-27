import { eq, sql } from 'drizzle-orm';
import type { Database } from './client';
import { rateLimits } from './schema';

export interface RateLimitState {
  count: number;
  resetAt: Date;
}

/** Fixed-window counter shared by all app instances. Returns the count after this hit. */
export async function hitRateLimit(
  db: Database,
  key: string,
  windowMs: number,
): Promise<RateLimitState> {
  const resetAt = new Date(Date.now() + windowMs);
  const result = (await db.execute(sql`
    insert into ${rateLimits} (key, count, reset_at) values (${key}, 1, ${resetAt.toISOString()}::timestamptz)
    on conflict (key) do update set
      count = case when ${rateLimits.resetAt} <= now() then 1 else ${rateLimits.count} + 1 end,
      reset_at = case when ${rateLimits.resetAt} <= now() then excluded.reset_at else ${rateLimits.resetAt} end
    returning count, reset_at
  `)) as unknown as { rows: { count: number; reset_at: string | Date }[] };
  const row = result.rows[0]!;
  return { count: Number(row.count), resetAt: new Date(row.reset_at) };
}

export async function peekRateLimit(db: Database, key: string): Promise<RateLimitState | null> {
  const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);
  if (!row || row.resetAt <= new Date()) return null;
  return { count: row.count, resetAt: row.resetAt };
}

export async function clearRateLimit(db: Database, key: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, key));
}

export async function pruneRateLimits(db: Database): Promise<void> {
  await db.delete(rateLimits).where(sql`${rateLimits.resetAt} < now() - interval '1 day'`);
}
