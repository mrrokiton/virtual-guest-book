import { computeSchedule, generateSlug } from '@vgb/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from './client';
import { createTestDb, insertTestUser } from './testing';
import { weddingScope } from './wedding-scope';
import {
  createWedding,
  ensureTenantForUser,
  getMembershipRole,
  listWeddingsForUser,
} from './weddings';
import { hitRateLimit, peekRateLimit } from './rate-limit';

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
    uploadDays: 7,
    plan: 'standard',
    pinCiphertext: 'x',
    ...computeSchedule(eventDate, 7, 'standard'),
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
});
