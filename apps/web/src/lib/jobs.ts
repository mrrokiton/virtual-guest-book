import { QUEUE_CONFIG, QUEUES, type QueueName } from '@vgb/core';
import { PgBoss, type SendOptions } from 'pg-boss';
import { env } from './env';

const g = globalThis as typeof globalThis & { __vgbBoss?: Promise<PgBoss> };

/** Producer-only instance: the worker owns maintenance, scheduling and schema migrations. */
function boss(): Promise<PgBoss> {
  g.__vgbBoss ??= (async () => {
    const b = new PgBoss({
      connectionString: env().DATABASE_URL,
      max: 2,
      supervise: false,
      schedule: false,
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

export async function enqueue(
  queue: QueueName,
  data: object,
  options?: SendOptions,
): Promise<void> {
  await (await boss()).send(queue, data, options);
}
