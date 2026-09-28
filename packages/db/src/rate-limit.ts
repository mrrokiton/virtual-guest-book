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

/** Keeps `key` blocked until `until`, regardless of when its window started. */
export async function lockRateLimit(db: Database, key: string, until: Date): Promise<void> {
  await db
    .update(rateLimits)
    .set({ resetAt: sql`greatest(${rateLimits.resetAt}, ${until.toISOString()}::timestamptz)` })
    .where(eq(rateLimits.key, key));
}

/** Atomic check-and-count in the shape Better Auth's `customStorage` expects. */
export async function consumeRateLimit(
  db: Database,
  key: string,
  windowMs: number,
  max: number,
): Promise<{ allowed: boolean; retryAfter: number | null }> {
  const state = await hitRateLimit(db, key, windowMs);
  if (state.count <= max) return { allowed: true, retryAfter: null };
  return {
    allowed: false,
    retryAfter: Math.max(1, Math.ceil((state.resetAt.getTime() - Date.now()) / 1000)),
  };
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
