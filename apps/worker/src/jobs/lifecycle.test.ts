import {
  addDays,
  MAX_PHOTO_REDRIVES,
  type MediaPurgeJob,
  QUEUES,
  type WeddingPurgeJob,
} from '@vgb/core';
import { getWeddingById, updateWedding, weddingScope } from '@vgb/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestContext, makeWedding, type TestContext } from '../test-utils';
import {
  advanceWedding,
  lifecycleTick,
  reconcileProcessing,
  sendDeletionReminder,
} from './lifecycle';
import { purgeMedia } from './media-purge';
import { purgeWedding } from './wedding-purge';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const eventDate = new Date('2026-07-04T14:00:00Z');

async function activeWedding() {
  const { wedding, owner } = await makeWedding(ctx.db, { eventDate });
  await updateWedding(ctx.db, wedding.id, { status: 'active' });
  return { wedding: (await getWeddingById(ctx.db, wedding.id))!, owner };
}

async function status(id: string) {
  return (await getWeddingById(ctx.db, id))?.status ?? 'gone';
}

describe('wedding lifecycle with an accelerated clock', () => {
  it('walks active -> read_only -> archived -> pending_deletion -> deleted', async () => {
    const { wedding, owner } = await activeWedding();
    const scope = weddingScope(ctx.db, wedding.id);
    const photo = await scope.media.create({
      kind: 'photo',
      status: 'ready',
      declaredContentType: 'image/jpeg',
      declaredSizeBytes: 10,
      variants: { thumb: `weddings/${wedding.id}/media/x/thumb.webp` },
    });
    await ctx.memory.put(
      `weddings/${wedding.id}/media/${photo.id}/thumb.webp`,
      Buffer.from('x'),
      'image/webp',
    );

    ctx.setNow(addDays(wedding.readOnlyAt, -1));
    await lifecycleTick(ctx);
    expect(await status(wedding.id)).toBe('active');

    ctx.setNow(addDays(wedding.readOnlyAt, 0.01));
    await lifecycleTick(ctx);
    expect(await status(wedding.id)).toBe('read_only');

    ctx.setNow(addDays(wedding.archiveAt, 0.01));
    await lifecycleTick(ctx);
    expect(await status(wedding.id)).toBe('archived');
    const exportJob = ctx.sent.find((s) => s.queue === QUEUES.weddingExport);
    expect(exportJob?.data).toMatchObject({ weddingId: wedding.id, notify: true });
    expect((await scope.exports.latest())?.status).toBe('pending');

    // Standard plan keeps the archive for 30 days before scheduling deletion.
    ctx.setNow(addDays(wedding.archiveAt, 31));
    await lifecycleTick(ctx);
    const pending = (await getWeddingById(ctx.db, wedding.id))!;
    expect(pending.status).toBe('pending_deletion');
    expect(pending.purgeAt?.getTime()).toBe(addDays(ctx.now(), 14).getTime());
    expect(
      ctx.mails.some(
        (m) => m.to === owner.email && m.subject.startsWith('Galeria zostanie usunięta'),
      ),
    ).toBe(true);
    const reminder = ctx.sent.find((s) => s.queue === QUEUES.deletionReminder);
    expect(reminder?.options).toMatchObject({ startAfter: addDays(pending.purgeAt!, -3) });

    await sendDeletionReminder(ctx, reminder!.data as never);
    expect(ctx.mails.some((m) => m.subject.startsWith('Przypomnienie'))).toBe(true);

    ctx.setNow(addDays(pending.purgeAt!, 0.01));
    await lifecycleTick(ctx);
    const purgeJob = ctx.sent.find((s) => s.queue === QUEUES.weddingPurge);
    expect(purgeJob?.data).toEqual({ weddingId: wedding.id });

    await purgeWedding(ctx, purgeJob!.data as WeddingPurgeJob);
    expect(await status(wedding.id)).toBe('gone');
    expect([...ctx.memory.objects.keys()].some((k) => k.includes(wedding.id))).toBe(false);
    // The audit log has no foreign key, so the purge entry outlives the wedding row.
    const audit = await weddingScope(ctx.db, wedding.id).auditTrail();
    expect(audit.map((a) => a.action)).toContain('wedding.purged');
  });

  it('catches up several stages after a long worker outage', async () => {
    const { wedding } = await activeWedding();
    ctx.setNow(addDays(wedding.archiveAt, 45));
    await lifecycleTick(ctx);
    expect(await status(wedding.id)).toBe('pending_deletion');
  });

  it('skips a stale reminder after the couple restored the wedding', async () => {
    const { wedding } = await activeWedding();
    const before = ctx.mails.length;
    await sendDeletionReminder(ctx, { weddingId: wedding.id, purgeAt: new Date().toISOString() });
    expect(ctx.mails.length).toBe(before);
  });

  it('fails an abandoned upload and purges its bytes', async () => {
    const { wedding } = await activeWedding();
    const scope = weddingScope(ctx.db, wedding.id);
    const upload = await scope.media.create({
      kind: 'photo',
      status: 'uploading',
      declaredContentType: 'image/jpeg',
      declaredSizeBytes: 10,
      originalKey: `weddings/${wedding.id}/media/abandoned/original`,
    });
    await ctx.memory.put(upload.originalKey!, Buffer.from('x'), 'image/jpeg');

    ctx.setNow(addDays(new Date(), 2));
    await lifecycleTick(ctx);
    expect((await scope.media.get(upload.id))?.status).toBe('failed');
    const job = ctx.sent.find(
      (s) => s.queue === QUEUES.mediaPurge && (s.data as MediaPurgeJob).mediaId === upload.id,
    );
    expect(job?.data).toEqual({ weddingId: wedding.id, mediaId: upload.id });

    await purgeMedia(ctx, job!.data as MediaPurgeJob);
    expect(ctx.memory.objects.has(upload.originalKey!)).toBe(false);
    expect((await scope.media.get(upload.id))?.purgedAt).not.toBeNull();
  });

  it('re-queues a photo stuck in processing instead of failing it', async () => {
    const { wedding } = await activeWedding();
    const scope = weddingScope(ctx.db, wedding.id);
    const photo = await scope.media.create({
      kind: 'photo',
      status: 'processing',
      declaredContentType: 'image/jpeg',
      declaredSizeBytes: 10,
      originalKey: `weddings/${wedding.id}/media/stuck/original`,
    });

    ctx.setNow(addDays(new Date(), 2));
    await lifecycleTick(ctx);
    expect((await scope.media.get(photo.id))?.status).toBe('processing');
    const job = ctx.sent.find(
      (s) =>
        s.queue === QUEUES.photoProcess && (s.data as { mediaId: string }).mediaId === photo.id,
    );
    expect(job?.options).toMatchObject({ singletonKey: photo.id });
    expect((await scope.media.get(photo.id))?.reprocessAttempts).toBe(1);
  });

  it('does not burn a redrive while the photo job is still queued or running', async () => {
    const { wedding } = await activeWedding();
    const scope = weddingScope(ctx.db, wedding.id);
    const photo = await scope.media.create({
      kind: 'photo',
      status: 'processing',
      declaredContentType: 'image/jpeg',
      declaredSizeBytes: 10,
      originalKey: `weddings/${wedding.id}/media/live/original`,
    });
    vi.spyOn(ctx.boss, 'send').mockResolvedValueOnce(null);
    await reconcileProcessing(ctx, (await scope.media.get(photo.id))!);
    expect(await scope.media.get(photo.id)).toMatchObject({
      status: 'processing',
      reprocessAttempts: 0,
    });
  });

  it('fails a photo that keeps getting stuck after the re-drive limit', async () => {
    const { wedding } = await activeWedding();
    const scope = weddingScope(ctx.db, wedding.id);
    const photo = await scope.media.create({
      kind: 'photo',
      status: 'processing',
      declaredContentType: 'image/jpeg',
      declaredSizeBytes: 10,
      originalKey: `weddings/${wedding.id}/media/poison/original`,
      reprocessAttempts: MAX_PHOTO_REDRIVES,
    });
    const m = (await scope.media.get(photo.id))!;
    await reconcileProcessing(ctx, m);
    expect(await scope.media.get(photo.id)).toMatchObject({
      status: 'failed',
      failureReason: 'processing_exhausted',
    });
  });

  it('gives up on a Stream video that stays pending for a day', async () => {
    const { wedding } = await activeWedding();
    const scope = weddingScope(ctx.db, wedding.id);
    const video = await scope.media.create({
      kind: 'video',
      status: 'processing',
      declaredContentType: 'video/mp4',
      declaredSizeBytes: 10,
      videoProvider: 'cloudflare',
      videoUid: 'uid-forever-pending',
    });
    vi.mocked(ctx.video.state).mockResolvedValue({ state: 'pending' } as never);
    ctx.setNow(new Date(video.createdAt.getTime() + 2 * 3600_000));
    await reconcileProcessing(ctx, video);
    expect((await scope.media.get(video.id))?.status).toBe('processing');

    ctx.setNow(new Date(video.createdAt.getTime() + 25 * 3600_000));
    await reconcileProcessing(ctx, video);
    vi.mocked(ctx.video.state).mockReset();
    expect(await scope.media.get(video.id)).toMatchObject({
      status: 'failed',
      failureReason: 'processing_timeout',
    });
  });

  it('does not apply a transition the couple postponed after the tick read the wedding', async () => {
    const { wedding } = await activeWedding();
    const stale = (await getWeddingById(ctx.db, wedding.id))!;
    await updateWedding(ctx.db, wedding.id, { readOnlyAt: addDays(wedding.readOnlyAt, 10) });
    ctx.setNow(addDays(wedding.readOnlyAt, 1));
    await advanceWedding(ctx, stale);
    expect(await status(wedding.id)).toBe('active');
  });

  it('purges files a lost processing run left behind', async () => {
    const { wedding } = await activeWedding();
    const scope = weddingScope(ctx.db, wedding.id);
    const photo = await scope.media.create({
      kind: 'photo',
      status: 'deleted',
      declaredContentType: 'image/jpeg',
      declaredSizeBytes: 10,
    });
    const orphan = `weddings/${wedding.id}/media/${photo.id}/full-deadbeef.jpg`;
    await ctx.memory.put(orphan, Buffer.from('x'), 'image/jpeg');
    await purgeMedia(ctx, { weddingId: wedding.id, mediaId: photo.id });
    expect(ctx.memory.objects.has(orphan)).toBe(false);
  });

  it('settles Stream videos from the API when the webhook never came', async () => {
    const { wedding } = await activeWedding();
    const scope = weddingScope(ctx.db, wedding.id);
    const video = (status: 'uploading' | 'processing', uid: string) =>
      scope.media.create({
        kind: 'video',
        status,
        declaredContentType: 'video/mp4',
        declaredSizeBytes: 10,
        videoProvider: 'cloudflare',
        videoUid: uid,
      });
    const encoded = await video('processing', 'uid-ready');
    const broken = await video('processing', 'uid-error');
    const closedTab = await video('uploading', 'uid-closed-tab');
    vi.mocked(ctx.video.state).mockImplementation(async (v) =>
      v.videoUid === 'uid-error'
        ? { state: 'failed', reason: 'codec' }
        : { state: 'ready', durationSeconds: 12 },
    );

    ctx.setNow(addDays(new Date(), 2));
    await lifecycleTick(ctx);
    vi.mocked(ctx.video.state).mockReset();

    expect(await scope.media.get(encoded.id)).toMatchObject({
      status: 'ready',
      durationSeconds: 12,
    });
    expect((await scope.media.get(closedTab.id))?.status).toBe('ready');
    expect(ctx.video.enableDownload).toHaveBeenCalledWith(
      expect.objectContaining({ id: encoded.id }),
    );
    expect(await scope.media.get(broken.id)).toMatchObject({
      status: 'failed',
      failureReason: 'codec',
    });
    expect(
      ctx.sent.some(
        (s) => s.queue === QUEUES.mediaPurge && (s.data as MediaPurgeJob).mediaId === broken.id,
      ),
    ).toBe(true);
  });

  it('retries the purge of a wedding left in deleted', async () => {
    const { wedding } = await activeWedding();
    await updateWedding(ctx.db, wedding.id, { status: 'deleted' });
    await lifecycleTick(ctx);
    const job = ctx.sent.find(
      (s) =>
        s.queue === QUEUES.weddingPurge && (s.data as WeddingPurgeJob).weddingId === wedding.id,
    );
    expect(job).toBeDefined();
    await purgeWedding(ctx, job!.data as WeddingPurgeJob);
    expect(await status(wedding.id)).toBe('gone');
  });

  it('does not purge a wedding that is no longer pending deletion', async () => {
    const { wedding } = await activeWedding();
    ctx.setNow(addDays(wedding.readOnlyAt, -1));
    await purgeWedding(ctx, { weddingId: wedding.id });
    expect(await status(wedding.id)).toBe('active');
  });
});
