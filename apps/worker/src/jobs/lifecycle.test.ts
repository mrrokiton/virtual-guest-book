import { addDays, type MediaPurgeJob, QUEUES, type WeddingPurgeJob } from '@vgb/core';
import { getWeddingById, updateWedding, weddingScope } from '@vgb/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, makeWedding, type TestContext } from '../test-utils';
import { lifecycleTick, sendDeletionReminder } from './lifecycle';
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

  it('does not purge a wedding that is no longer pending deletion', async () => {
    const { wedding } = await activeWedding();
    ctx.setNow(addDays(wedding.readOnlyAt, -1));
    await purgeWedding(ctx, { weddingId: wedding.id });
    expect(await status(wedding.id)).toBe('active');
  });
});
