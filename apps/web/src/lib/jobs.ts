import { PG_BOSS_QUEUE_CACHE_SECONDS, QUEUE_CONFIG, QUEUES, type QueueName } from '@vgb/core';
import { PgBoss, type SendOptions } from 'pg-boss';
import { env } from './env';

/** The worker stays awake 15 minutes per wake, so one request a minute per process is plenty. */
const WAKE_THROTTLE_MS = 60_000;
const WAKE_TIMEOUT_MS = 2_000;

const g = globalThis as typeof globalThis & { __vgbBoss?: Promise<PgBoss>; __vgbLastWake?: number };

/** Producer-only instance: the worker owns maintenance, scheduling and schema migrations. */
function boss(): Promise<PgBoss> {
  g.__vgbBoss ??= (async () => {
    const b = new PgBoss({
      connectionString: env().DATABASE_URL,
      max: 2,
      supervise: false,
      schedule: false,
      queueCacheIntervalSeconds: PG_BOSS_QUEUE_CACHE_SECONDS,
    });
    b.on('error', (err) => console.error('[pg-boss]', err));
    await b.start();
    for (const name of Object.values(QUEUES)) {
      if (!(await b.getQueue(name))) await b.createQueue(name, QUEUE_CONFIG[name]);
    }
    return b;
  })().catch((err) => {
    g.__vgbBoss = undefined;
    throw err;
  });
  return g.__vgbBoss;
}

function startsLater(startAfter: SendOptions['startAfter']): boolean {
  if (startAfter === undefined) return false;
  if (typeof startAfter === 'number') return startAfter > 0;
  return new Date(startAfter).getTime() > Date.now();
}

export async function enqueue(
  queue: QueueName,
  data: object,
  options?: SendOptions,
): Promise<void> {
  await (await boss()).send(queue, data, options);
  if (!startsLater(options?.startAfter)) void wakeWorker();
}

/**
 * Tells a sleeping worker there is work, or that a wedding window may have just opened. Without it
 * the worker would only notice at its hourly tick. Best effort: never throws.
 */
export async function wakeWorker(): Promise<void> {
  const { WORKER_WAKE_URL: url, WORKER_WAKE_TOKEN: token } = env();
  if (!url || !token) return;
  const now = Date.now();
  if (now - (g.__vgbLastWake ?? 0) < WAKE_THROTTLE_MS) return;
  g.__vgbLastWake = now;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
    });
    if (!res.ok) console.warn('[worker-wake] unexpected status %d', res.status);
  } catch (err) {
    console.warn('[worker-wake] failed:', err instanceof Error ? err.message : err);
  }
}
