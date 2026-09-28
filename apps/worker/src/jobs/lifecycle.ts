import {
  addDays,
  DELETION_REMINDER_DAYS,
  dueTransition,
  MAX_PHOTO_REDRIVES,
  mediaPurgeRequest,
  QUEUES,
  transitionDeadlines,
  type DeletionReminderJob,
  type LifecycleEvent,
  type PhotoProcessJob,
  type SendEmailJob,
  type WeddingExportJob,
  type WeddingPurgeJob,
} from '@vgb/core';
import {
  applyWeddingTransition,
  getWeddingById,
  listLifecycleCandidates,
  listOwnerEmails,
  listPurgeBacklog,
  listStaleUploads,
  listStuckProcessing,
  markMediaFailed,
  markVideoReady,
  pruneRateLimits,
  toLifecycle,
  weddingScope,
  type Media,
  type Wedding,
} from '@vgb/db';
import { emails } from '@vgb/services';
import { dashboardUrl, type Context } from '../context';

const STALE_UPLOAD_HOURS = 24;
/** Photo retries and Stream encoding normally finish within minutes. */
const STUCK_PROCESSING_MINUTES = 60;
/** Stream still reporting "processing" after this long will not finish. */
const STUCK_VIDEO_HOURS = 24;
const PURGE_BACKLOG_HOURS = 1;
/** A wedding can at most pass active -> read_only -> archived -> pending_deletion in one tick. */
const MAX_STEPS = 4;

/** Each message is its own retried job, so one failed delivery neither blocks nor repeats others. */
export async function queueEmail(ctx: Pick<Context, 'boss'>, message: SendEmailJob): Promise<void> {
  await ctx.boss.send(QUEUES.sendEmail, message);
}

export async function sendEmail(ctx: Context, message: SendEmailJob): Promise<void> {
  await ctx.mailer.send(message);
}

export async function notifyOwners(
  ctx: Context,
  w: Pick<Wedding, 'id'>,
  build: (to: string) => SendEmailJob,
) {
  const owners = await listOwnerEmails(ctx.db, w.id);
  for (const o of owners) await queueEmail(ctx, build(o.email));
}

export async function scheduleDeletionReminder(
  ctx: Pick<Context, 'boss'>,
  weddingId: string,
  purgeAt: Date,
  now: Date,
) {
  const remindAt = addDays(purgeAt, -DELETION_REMINDER_DAYS);
  if (remindAt <= now) return;
  const data: DeletionReminderJob = { weddingId, purgeAt: purgeAt.toISOString() };
  await ctx.boss.send(QUEUES.deletionReminder, data, {
    startAfter: remindAt,
    singletonKey: `${weddingId}:${data.purgeAt}`,
  });
}

async function onTransition(ctx: Context, w: Wedding, event: LifecycleEvent): Promise<void> {
  const scope = weddingScope(ctx.db, w.id);
  await scope.audit({
    actorType: 'system',
    action: `wedding.${event.type}`,
    targetType: 'wedding',
    targetId: w.id,
  });

  switch (event.type) {
    case 'archived': {
      // Guests lose access now; the couple gets the full package by e-mail.
      const row = await scope.exports.create(null);
      const job: WeddingExportJob = { weddingId: w.id, exportId: row.id, notify: true };
      await ctx.boss.send(QUEUES.weddingExport, job);
      break;
    }
    case 'deletion_scheduled':
      await scheduleDeletionReminder(ctx, w.id, event.purgeAt, ctx.now());
      await notifyOwners(ctx, w, (to) =>
        emails.deletionScheduled(to, {
          weddingName: w.name,
          purgeAt: event.purgeAt,
          url: dashboardUrl(ctx.cfg, w.id),
          automatic: event.automatic,
        }),
      );
      break;
    default:
      break;
  }
}

export async function advanceWedding(ctx: Context, wedding: Wedding): Promise<void> {
  const now = ctx.now();
  let current = wedding;
  for (let step = 0; step < MAX_STEPS; step++) {
    const t = dueTransition(toLifecycle(current), now);
    if (!t) return;
    if (t.event.type === 'purge_due') {
      const job: WeddingPurgeJob = { weddingId: current.id };
      await ctx.boss.send(QUEUES.weddingPurge, job, { singletonKey: current.id });
      return;
    }
    const next = await applyWeddingTransition(ctx.db, current.id, current.status, t, {
      deadlines: transitionDeadlines(toLifecycle(current), now),
    });
    if (!next) return; // Changed concurrently (e.g. the couple restored it); next tick re-evaluates.
    await onTransition(ctx, next, t.event);
    current = next;
  }
}

export async function lifecycleTick(ctx: Context): Promise<void> {
  const now = ctx.now();

  for (const wedding of await listLifecycleCandidates(ctx.db, now)) {
    try {
      await advanceWedding(ctx, wedding);
    } catch (err) {
      console.error('[lifecycle] wedding %s failed', wedding.id, err);
    }
  }

  for (const m of await listStaleUploads(
    ctx.db,
    new Date(now.getTime() - STALE_UPLOAD_HOURS * 3600_000),
  )) {
    try {
      await expireUpload(ctx, m);
    } catch (err) {
      console.error('[lifecycle] expire upload %s failed', m.id, err);
    }
  }
  for (const m of await listStuckProcessing(
    ctx.db,
    new Date(now.getTime() - STUCK_PROCESSING_MINUTES * 60_000),
  )) {
    try {
      await reconcileProcessing(ctx, m);
    } catch (err) {
      console.error('[lifecycle] reconcile media %s failed', m.id, err);
    }
  }
  for (const m of await listPurgeBacklog(
    ctx.db,
    new Date(now.getTime() - PURGE_BACKLOG_HOURS * 3600_000),
  )) {
    try {
      await sendPurge(ctx, m);
    } catch (err) {
      console.error('[lifecycle] purge backlog %s failed', m.id, err);
    }
  }
  await pruneRateLimits(ctx.db);
}

function sendPurge(ctx: Context, m: Pick<Media, 'id' | 'weddingId'>) {
  return ctx.boss.send(...mediaPurgeRequest(m.weddingId, m.id));
}

async function expireUpload(ctx: Context, m: Media): Promise<void> {
  // The guest may have closed the tab after Stream got the file and the webhook was lost.
  if (m.kind === 'video' && m.videoProvider === 'cloudflare') {
    const state = await ctx.video.state(m);
    if (state.state === 'ready') {
      await ctx.video.enableDownload(m);
      await markVideoReady(ctx.db, m, state, ctx.now());
      return;
    }
  }
  const failed = await weddingScope(ctx.db, m.weddingId).media.update(
    m.id,
    { status: 'failed', failureReason: 'abandoned' },
    { from: ['uploading'] },
  );
  if (failed) await sendPurge(ctx, m);
}

async function fail(ctx: Context, m: Media, reason: string): Promise<void> {
  if (await markMediaFailed(ctx.db, m, reason)) await sendPurge(ctx, m);
}

/**
 * Re-drives an item stuck in `processing` a bounded number of times, so one file that keeps
 * crashing the decoder cannot burn worker time forever. The attempt counter only moves when
 * pg-boss actually accepts a new job (`send` returns null while the previous one is still live).
 */
export async function reconcileProcessing(ctx: Context, m: Media): Promise<void> {
  if (m.kind === 'photo') {
    if (!m.originalKey) return fail(ctx, m, 'missing_original');
    if (m.reprocessAttempts >= MAX_PHOTO_REDRIVES) return fail(ctx, m, 'processing_exhausted');
    const job: PhotoProcessJob = { weddingId: m.weddingId, mediaId: m.id };
    // null = this photo already has a queued or active job; do not burn a redrive slot.
    if (!(await ctx.boss.send(QUEUES.photoProcess, job, { singletonKey: m.id }))) return;
    await weddingScope(ctx.db, m.weddingId).media.update(
      m.id,
      { reprocessAttempts: m.reprocessAttempts + 1 },
      { from: ['processing'] },
    );
    return;
  }
  const state = await ctx.video.state(m);
  if (state.state === 'ready') {
    await ctx.video.enableDownload(m);
    await markVideoReady(ctx.db, m, state, ctx.now());
  } else if (state.state === 'failed') {
    await fail(ctx, m, state.reason);
  } else if (ctx.now().getTime() - m.createdAt.getTime() > STUCK_VIDEO_HOURS * 3600_000) {
    await fail(ctx, m, 'processing_timeout');
  }
}

export async function sendDeletionReminder(ctx: Context, job: DeletionReminderJob): Promise<void> {
  const w = await getWeddingById(ctx.db, job.weddingId);
  if (!w || w.status !== 'pending_deletion' || w.purgeAt?.toISOString() !== job.purgeAt) return;
  await notifyOwners(ctx, w, (to) =>
    emails.deletionReminder(to, {
      weddingName: w.name,
      purgeAt: w.purgeAt!,
      url: `${dashboardUrl(ctx.cfg, w.id)}#export`,
    }),
  );
}
