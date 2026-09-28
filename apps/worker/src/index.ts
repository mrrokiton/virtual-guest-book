import {
  QUEUE_CONFIG,
  QUEUES,
  type DeletionReminderJob,
  type MediaPurgeJob,
  type PhotoProcessJob,
  type SendEmailJob,
  type WeddingExportJob,
  type WeddingPurgeJob,
} from '@vgb/core';
import * as Sentry from '@sentry/node';
import { PgBoss, type Job } from 'pg-boss';
import { createServices, type Context } from './context';
import { exportWedding } from './jobs/export';
import { lifecycleTick, sendDeletionReminder, sendEmail } from './jobs/lifecycle';
import { purgeMedia } from './jobs/media-purge';
import { processPhoto } from './jobs/photo';
import { purgeWedding } from './jobs/wedding-purge';

async function main() {
  const services = createServices();
  if (services.cfg.SENTRY_DSN) {
    Sentry.init({
      dsn: services.cfg.SENTRY_DSN,
      environment: services.cfg.NODE_ENV,
    });
  }
  const boss = new PgBoss({ connectionString: services.cfg.DATABASE_URL, max: 6 });
  boss.on('error', (err) => console.error('[pg-boss]', err));
  await boss.start();

  for (const [name, { policy, ...options }] of Object.entries(QUEUE_CONFIG)) {
    if (await boss.getQueue(name)) await boss.updateQueue(name, options);
    else await boss.createQueue(name, { ...options, policy });
  }

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

  await boss.work<PhotoProcessJob>(
    QUEUES.photoProcess,
    { localConcurrency: 2 },
    handle('photo', processPhoto),
  );
  await boss.work<MediaPurgeJob>(
    QUEUES.mediaPurge,
    { localConcurrency: 4 },
    handle('media-purge', purgeMedia),
  );
  await boss.work<WeddingExportJob>(QUEUES.weddingExport, handle('export', exportWedding));
  await boss.work<WeddingPurgeJob>(QUEUES.weddingPurge, handle('wedding-purge', purgeWedding));
  await boss.work<DeletionReminderJob>(
    QUEUES.deletionReminder,
    handle('reminder', sendDeletionReminder),
  );
  await boss.work<SendEmailJob>(
    QUEUES.sendEmail,
    { localConcurrency: 2 },
    handle('email', sendEmail),
  );
  await boss.work(
    QUEUES.lifecycleTick,
    handle('lifecycle', (c) => lifecycleTick(c)),
  );
  await boss.schedule(QUEUES.lifecycleTick, '*/10 * * * *');
  await boss.send(QUEUES.lifecycleTick, {});

  console.info('[worker] started');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.info('[worker] %s received, finishing active jobs', signal);
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
