import {
  addDays,
  DELETION_REMINDER_DAYS,
  dueTransition,
  QUEUES,
  type DeletionReminderJob,
  type LifecycleEvent,
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
const PURGE_BACKLOG_HOURS = 1;
/** A wedding can at most pass active -> read_only -> archived -> pending_deletion in one tick. */
const MAX_STEPS = 4;

async function notifyOwners(
  ctx: Context,
  w: Wedding,
  build: (to: string) => Parameters<Context['mailer']['send']>[0],
) {
  const owners = await listOwnerEmails(ctx.db, w.id);
  await Promise.all(owners.map((o) => ctx.mailer.send(build(o.email))));
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
      await notifyOwners(ctx, w, (to) =>
        emails.deletionScheduled(to, {
          weddingName: w.name,
          purgeAt: event.purgeAt,
          url: dashboardUrl(ctx.cfg, w.id),
          automatic: event.automatic,
        }),
      );
      await scheduleDeletionReminder(ctx, w.id, event.purgeAt, ctx.now());
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
    const next = await applyWeddingTransition(ctx.db, current.id, current.status, t);
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
    await sendPurge(ctx, m);
  }
  await pruneRateLimits(ctx.db);
}

function sendPurge(ctx: Context, m: Pick<Media, 'id' | 'weddingId'>) {
  return ctx.boss.send(
    QUEUES.mediaPurge,
    { weddingId: m.weddingId, mediaId: m.id },
    { singletonKey: m.id },
  );
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

/** Re-drives an item stuck in `processing`; the bytes are only dropped once they are gone. */
export async function reconcileProcessing(ctx: Context, m: Media): Promise<void> {
  if (m.kind === 'photo') {
    if (!m.originalKey) {
      if (await markMediaFailed(ctx.db, m, 'missing_original')) await sendPurge(ctx, m);
      return;
    }
    await ctx.boss.send(
      QUEUES.photoProcess,
      { weddingId: m.weddingId, mediaId: m.id },
      { singletonKey: m.id },
    );
    return;
  }
  const state = await ctx.video.state(m);
  if (state.state === 'ready') {
    await ctx.video.enableDownload(m);
    await markVideoReady(ctx.db, m, state, ctx.now());
  } else if (state.state === 'failed') {
    if (await markMediaFailed(ctx.db, m, state.reason)) await sendPurge(ctx, m);
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
