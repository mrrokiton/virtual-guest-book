import {
  PG_BOSS_QUEUE_CACHE_SECONDS,
  QUEUE_CONFIG,
  QUEUES,
  type DeletionReminderJob,
  type MediaPurgeJob,
  type PhotoProcessJob,
  type SendEmailJob,
  type WeddingExportJob,
  type WeddingPurgeJob,
} from '@vgb/core';
import { listOpenUploadWindows } from '@vgb/db';
import * as Sentry from '@sentry/node';
import { PgBoss, type Job } from 'pg-boss';
import { createServices, type Context } from './context';
import { exportWedding } from './jobs/export';
import { lifecycleTick, sendDeletionReminder, sendEmail } from './jobs/lifecycle';
import { purgeMedia } from './jobs/media-purge';
import { processPhoto } from './jobs/photo';
import { purgeWedding } from './jobs/wedding-purge';
import { WorkerRuntime, type QueueWorker } from './runtime';
import { startWakeServer } from './wake-server';

async function main() {
  const services = createServices();
  if (services.cfg.SENTRY_DSN) {
    Sentry.init({
      dsn: services.cfg.SENTRY_DSN,
      environment: services.cfg.NODE_ENV,
    });
  }
  // WorkerRuntime drives lifecycle-tick and maintenance itself, so it can stop touching Postgres
  // while no wedding needs it. pg-boss's own timers would keep Neon awake around the clock.
  const boss = new PgBoss({
    connectionString: services.cfg.DATABASE_URL,
    max: 6,
    supervise: false,
    schedule: false,
    queueCacheIntervalSeconds: PG_BOSS_QUEUE_CACHE_SECONDS,
  });
  boss.on('error', (err) => console.error('[pg-boss]', err));
  await boss.start();

  for (const [name, { policy, ...options }] of Object.entries(QUEUE_CONFIG)) {
    if (await boss.getQueue(name)) await boss.updateQueue(name, options);
    else await boss.createQueue(name, { ...options, policy });
  }
  // Replaced by the runtime timer; a leftover cron row would fire again if scheduling came back.
  await boss.unschedule(QUEUES.lifecycleTick);

  const ctx: Context = { ...services, boss };

  const handle =
    <T>(name: string, fn: (ctx: Context, data: T) => Promise<void>) =>
    async ([job]: Job<T>[]) => {
      if (!job) return;
      const started = Date.now();
      try {
        await fn(ctx, job.data);
        console.info('[job] %s %s ok in %dms', name, job.id, Date.now() - started);
      } catch (err) {
        console.error('[job] %s %s failed', name, job.id, err);
        Sentry.captureException(err, { tags: { queue: name }, extra: { jobId: job.id } });
        throw err;
      }
    };

  const workers: QueueWorker[] = [
    {
      name: QUEUES.photoProcess,
      options: { localConcurrency: 2 },
      handler: handle<PhotoProcessJob>('photo', processPhoto),
    },
    {
      name: QUEUES.mediaPurge,
      options: { localConcurrency: 4 },
      handler: handle<MediaPurgeJob>('media-purge', purgeMedia),
    },
    {
      name: QUEUES.weddingExport,
      options: {},
      handler: handle<WeddingExportJob>('export', exportWedding),
    },
    {
      name: QUEUES.weddingPurge,
      options: {},
      handler: handle<WeddingPurgeJob>('wedding-purge', purgeWedding),
    },
    {
      name: QUEUES.deletionReminder,
      options: {},
      handler: handle<DeletionReminderJob>('reminder', sendDeletionReminder),
    },
    {
      name: QUEUES.sendEmail,
      options: { localConcurrency: 2 },
      handler: handle<SendEmailJob>('email', sendEmail),
    },
    {
      name: QUEUES.lifecycleTick,
      options: {},
      handler: handle('lifecycle', (c) => lifecycleTick(c)),
    },
  ];

  const token = services.cfg.WORKER_WAKE_TOKEN;
  const runtime = new WorkerRuntime({
    boss,
    listWindows: (now) => listOpenUploadWindows(services.db, now),
    workers,
    sleepEnabled: Boolean(token),
    now: services.now,
  });
  await runtime.start();
  const wakeServer = token
    ? await startWakeServer({
        port: services.cfg.WORKER_WAKE_PORT,
        token,
        onWake: () => void runtime.wake('request'),
      })
    : null;

  console.info('[worker] started (sleep mode %s)', token ? 'on' : 'off');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.info('[worker] %s received, finishing active jobs', signal);
    wakeServer?.close();
    await runtime.stop();
    await boss.stop({ graceful: true, timeout: 60_000 });
    await Sentry.flush(2000);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[worker] fatal', err);
  process.exit(1);
});
