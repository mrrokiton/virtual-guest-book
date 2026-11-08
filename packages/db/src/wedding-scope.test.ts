import { computeSchedule, generateSlug } from '@vgb/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from './client';
import { createTestDb, insertTestUser } from './testing';
import { weddingScope } from './wedding-scope';
import {
  createWedding,
  ensureTenantForUser,
  getMembershipRole,
  getWeddingById,
  listWeddingsForUser,
  updateWedding,
} from './weddings';
import { markMediaFailed, markVideoReady } from './video-state';
import { consumeRateLimit, hitRateLimit, lockRateLimit, peekRateLimit } from './rate-limit';

let db: Database;
let close: () => Promise<void>;

async function makeWedding(name: string) {
  const owner = await insertTestUser(db);
  const tenantId = await ensureTenantForUser(db, owner.id, name);
  const eventDate = new Date('2026-07-01T15:00:00Z');
  const wedding = await createWedding(db, {
    tenantId,
    createdByUserId: owner.id,
    slug: generateSlug(),
    name,
    eventDate,
    uploadDays: 3,
    plan: 'standard',
    pinCiphertext: 'x',
    ...computeSchedule(eventDate, 3, 'standard'),
  });
  return { owner, wedding };
}

const photo = {
  kind: 'photo' as const,
  declaredContentType: 'image/jpeg',
  declaredSizeBytes: 1000,
};

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

describe('wedding isolation', () => {
  it('never returns, updates or counts another wedding’s media', async () => {
    const a = await makeWedding('A');
    const b = await makeWedding('B');
    const scopeA = weddingScope(db, a.wedding.id);
    const scopeB = weddingScope(db, b.wedding.id);

    const mediaA = await scopeA.media.create({ ...photo, status: 'ready' });
    const mediaB = await scopeB.media.create({ ...photo, status: 'ready' });
    await scopeB.media.create({
      ...photo,
      kind: 'video',
      declaredContentType: 'video/mp4',
      status: 'ready',
    });

    expect((await scopeA.media.gallery()).items.map((m) => m.id)).toEqual([mediaA.id]);
    expect((await scopeA.media.adminList()).items.map((m) => m.id)).toEqual([mediaA.id]);
    expect(await scopeA.media.get(mediaB.id)).toBeNull();
    expect(await scopeA.media.update(mediaB.id, { status: 'hidden' })).toBeNull();
    expect(await scopeA.media.updateMany([mediaB.id], { status: 'hidden' })).toEqual([]);
    expect((await scopeB.media.get(mediaB.id))?.status).toBe('ready');
    expect(await scopeA.media.usage()).toEqual({ total: 1, videos: 0 });
    expect(await scopeB.media.usage()).toEqual({ total: 2, videos: 1 });
  });

  it('scopes guest sessions to their wedding', async () => {
    const a = await makeWedding('A2');
    const b = await makeWedding('B2');
    const session = await weddingScope(db, a.wedding.id).guestSessions.create({
      displayName: 'Ola',
    });
    expect(await weddingScope(db, b.wedding.id).guestSessions.getActive(session.id)).toBeNull();
    expect(
      (await weddingScope(db, a.wedding.id).guestSessions.getActive(session.id))?.displayName,
    ).toBe('Ola');
  });

  it('does not expose weddings to non-members', async () => {
    const a = await makeWedding('A3');
    const stranger = await insertTestUser(db);
    expect(await getMembershipRole(db, a.wedding.id, a.owner.id)).toBe('owner');
    expect(await getMembershipRole(db, a.wedding.id, stranger.id)).toBeNull();
    expect(await listWeddingsForUser(db, stranger.id)).toEqual([]);
  });
});

describe('gallery pagination', () => {
  it('pages with a stable keyset cursor and hides non-ready media', async () => {
    const { wedding } = await makeWedding('Paging');
    const scope = weddingScope(db, wedding.id);
    const created = [];
    for (let i = 0; i < 7; i++)
      created.push(await scope.media.create({ ...photo, status: 'ready' }));
    const ids = created
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime() || (y.id > x.id ? 1 : -1))
      .map((m) => m.id);
    await scope.media.create({ ...photo, status: 'hidden' });
    await scope.media.create({ ...photo, status: 'processing' });

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await scope.media.gallery({ cursor, limit: 3 });
      seen.push(...page.items.map((m) => m.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(ids);
  });
});

describe('rate limits', () => {
  it('counts hits inside the window', async () => {
    expect((await hitRateLimit(db, 'k1', 60_000)).count).toBe(1);
    expect((await hitRateLimit(db, 'k1', 60_000)).count).toBe(2);
    expect((await peekRateLimit(db, 'k1'))?.count).toBe(2);
    expect(await peekRateLimit(db, 'unknown')).toBeNull();
  });

  it('keeps a locked key blocked past its original window', async () => {
    await hitRateLimit(db, 'k2', 1_000);
    const until = new Date(Date.now() + 15 * 60_000);
    await lockRateLimit(db, 'k2', until);
    expect((await peekRateLimit(db, 'k2'))?.resetAt.getTime()).toBe(until.getTime());
    await lockRateLimit(db, 'k2', new Date(Date.now() + 60_000));
    expect((await peekRateLimit(db, 'k2'))?.resetAt.getTime()).toBe(until.getTime());
  });

  it('allows up to max hits and then reports when to retry', async () => {
    expect(await consumeRateLimit(db, 'k3', 60_000, 2)).toEqual({
      allowed: true,
      retryAfter: null,
    });
    expect((await consumeRateLimit(db, 'k3', 60_000, 2)).allowed).toBe(true);
    const denied = await consumeRateLimit(db, 'k3', 60_000, 2);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBeGreaterThan(55);
    expect(denied.retryAfter).toBeLessThanOrEqual(60);
  });
});

describe('status guards', () => {
  it('does not save settings over a status that changed meanwhile', async () => {
    const { wedding } = await makeWedding('Guard');
    expect(
      await updateWedding(db, wedding.id, { name: 'X' }, { expectedStatus: 'active' }),
    ).toBeNull();
    expect((await getWeddingById(db, wedding.id))?.name).toBe('Guard');
    expect(
      await updateWedding(db, wedding.id, { name: 'X' }, { expectedStatus: 'draft' }),
    ).toMatchObject({ name: 'X' });
  });

  it('keeps a hidden video hidden when Stream redelivers its webhook', async () => {
    const { wedding } = await makeWedding('Redelivery');
    const scope = weddingScope(db, wedding.id);
    const video = await scope.media.create({
      kind: 'video',
      status: 'processing',
      declaredContentType: 'video/mp4',
      declaredSizeBytes: 1000,
      videoProvider: 'cloudflare',
      videoUid: 'uid-1',
    });
    const now = new Date();
    expect(await markVideoReady(db, video, { durationSeconds: 3 }, now)).toBe(true);
    await scope.media.update(video.id, { status: 'hidden', hiddenAt: now });
    expect(await markVideoReady(db, video, { durationSeconds: 3 }, now)).toBe(false);
    expect(await markMediaFailed(db, video, 'codec')).toBe(false);
    expect((await scope.media.get(video.id))?.status).toBe('hidden');
  });
});

describe('usage', () => {
  it('stops counting an upload the browser abandoned', async () => {
    const { wedding } = await makeWedding('Usage');
    const scope = weddingScope(db, wedding.id);
    await scope.media.create({
      kind: 'photo',
      status: 'uploading',
      declaredContentType: 'image/jpeg',
      declaredSizeBytes: 10,
    });
    await scope.media.create({
      kind: 'video',
      status: 'ready',
      declaredContentType: 'video/mp4',
      declaredSizeBytes: 10,
    });
    expect(await scope.media.usage()).toEqual({ total: 2, videos: 1 });
    const later = new Date(Date.now() + 2 * 3600_000);
    expect(await scope.media.usage(later)).toEqual({ total: 1, videos: 1 });
  });
});

describe('music suggestions', () => {
  it('does not leak suggestions across weddings and only the author can delete', async () => {
    const a = await makeWedding('Music A');
    const b = await makeWedding('Music B');
    const scopeA = weddingScope(db, a.wedding.id);
    const scopeB = weddingScope(db, b.wedding.id);
    const author = await scopeA.guestSessions.create({ displayName: 'Ola' });
    const stranger = await scopeA.guestSessions.create({ displayName: 'Jan' });
    const row = await scopeA.music.create({
      guestSessionId: author.id,
      authorName: 'Ola',
      kind: 'track',
      body: 'Dancing Queen',
      bodyKey: 'dancing queen',
      fairQueue: false,
    });

    expect(await scopeB.music.get(row.id)).toBeNull();
    expect((await scopeA.music.listOpen()).map((item) => item.id)).toEqual([row.id]);
    expect(await scopeA.music.softDelete(row.id, stranger.id)).toBeNull();
    expect(await scopeA.music.softDelete(row.id, author.id)).not.toBeNull();
    expect(await scopeA.music.listOpen()).toEqual([]);
    expect(await scopeA.music.durableCapInput(author.id)).toMatchObject({
      mine: 1,
      totalDurable: 1,
      authorCount: 1,
    });
  });
});

describe('party bingo', () => {
  it('keeps task submissions scoped and archives used tasks', async () => {
    const a = await makeWedding('Bingo A');
    const b = await makeWedding('Bingo B');
    const scopeA = weddingScope(db, a.wedding.id);
    const scopeB = weddingScope(db, b.wedding.id);
    const task = await scopeA.bingo.tasks.create('Zdjęcie z parą młodą');
    const session = await scopeA.guestSessions.create({ displayName: 'Ola' });

    const upload = await scopeA.bingo.createUpload({
      taskId: task.id,
      guestSessionId: session.id,
      media: {
        ...photo,
        status: 'uploading',
        guestSessionId: session.id,
        uploaderName: 'Ola',
      },
    });
    expect(upload?.submission.taskId).toBe(task.id);
    expect((await scopeB.bingo.tasks.list()).length).toBe(0);
    expect(await scopeB.bingo.getSubmissionByMedia(upload!.media.id)).toBeNull();
    expect(await scopeA.bingo.tasks.remove(task.id)).toBe('archived');
    expect(await scopeA.bingo.tasks.list()).toEqual([]);
    expect((await scopeA.bingo.tasks.list(true))[0]?.id).toBe(task.id);
  });

  it('withdraws an accepted photo atomically and excludes it from the gallery', async () => {
    const { wedding, owner } = await makeWedding('Bingo replacement');
    const scope = weddingScope(db, wedding.id);
    const task = await scope.bingo.tasks.create('Szalony taniec');
    const session = await scope.guestSessions.create({ displayName: 'Jan' });
    const upload = await scope.bingo.createUpload({
      taskId: task.id,
      guestSessionId: session.id,
      media: {
        ...photo,
        status: 'ready',
        guestSessionId: session.id,
        uploaderName: 'Jan',
      },
    });
    await scope.bingo.markSubmitted(upload!.media.id);
    expect(
      await scope.bingo.verify(upload!.submission.id, 'accepted', owner.id, null),
    ).not.toBeNull();
    expect((await scope.media.gallery()).items).toEqual([]);

    const removed = await scope.bingo.withdrawOwned(upload!.media.id, session.id);
    expect(removed?.media.status).toBe('deleted');
    expect((await scope.bingo.guestData(session.id)).submissions).toEqual([]);
  });

  it('keeps several active photos and moves completion time only on a real transition', async () => {
    const a = await makeWedding('Bingo progress');
    const b = await makeWedding('Bingo other');
    const scope = weddingScope(db, a.wedding.id);
    const other = weddingScope(db, b.wedding.id);
    const first = await scope.bingo.tasks.create('Para młoda');
    const second = await scope.bingo.tasks.create('Taniec');
    const session = await scope.guestSessions.create({ displayName: 'Ola' });
    const otherSession = await other.guestSessions.create({ displayName: 'Jan' });
    const create = async (taskId: string, owner = scope, guest = session.id) => {
      const created = await owner.bingo.createUpload({
        taskId,
        guestSessionId: guest,
        media: { ...photo, status: 'uploading', guestSessionId: guest, uploaderName: 'Ola' },
      });
      return created!;
    };
    const markReady = (owner: typeof scope, mediaId: string) =>
      owner.media.update(mediaId, { status: 'ready' }, { from: ['uploading'] });

    const firstPhoto = await create(first.id);
    const secondPhoto = await create(second.id);
    const extra = await create(first.id);
    await markReady(scope, firstPhoto.media.id);
    await markReady(scope, secondPhoto.media.id);
    await markReady(scope, extra.media.id);
    const started = new Date('2026-10-28T19:43:00Z');
    await scope.bingo.syncProgress(session.id, started);
    await scope.bingo.syncProgress(session.id, new Date('2026-10-28T19:50:00Z'));
    const [row] = await scope.bingo.progress();
    expect(row?.photosCompletedAt).toEqual(started);
    expect((await scope.bingo.guestData(session.id)).submissions).toHaveLength(3);

    await scope.bingo.verify(extra.submission.id, 'rejected', a.owner.id, 'Za ciemne');
    expect((await scope.bingo.progress())[0]?.photosCompletedAt).toEqual(started);
    await scope.bingo.verify(firstPhoto.submission.id, 'accepted', a.owner.id, null);
    expect((await scope.bingo.progress())[0]?.photosCompletedAt).toEqual(started);

    await scope.bingo.verify(secondPhoto.submission.id, 'rejected', a.owner.id, 'Nie widać pary');
    expect((await scope.bingo.progress())[0]?.photosCompletedAt).toBeNull();

    await scope.bingo.tasks.remove(second.id);
    const restored = (await scope.bingo.progress())[0]?.photosCompletedAt;
    expect(restored).not.toBeNull();
    await scope.bingo.syncProgress(session.id, new Date('2026-10-28T20:20:00Z'));
    expect((await scope.bingo.progress())[0]?.photosCompletedAt).toEqual(restored);

    const foreignTask = await other.bingo.tasks.create('Inne wesele');
    const foreign = await create(foreignTask.id, other, otherSession.id);
    await markReady(other, foreign.media.id);
    await other.bingo.syncProgress(otherSession.id, new Date('2026-10-28T21:00:00Z'));
    expect((await scope.bingo.progress()).map((item) => item.guestSessionId)).toEqual([session.id]);
    expect(await other.bingo.getSubmissionByMedia(firstPhoto.media.id)).toBeNull();
  });
});
