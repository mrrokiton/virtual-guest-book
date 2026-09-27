import { mediaStorageKey } from '@vgb/core';
import { weddingScope } from '@vgb/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, makeWedding, type TestContext } from '../test-utils';
import { exportKey, exportWedding } from './export';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

describe('exportWedding', () => {
  it('streams ready photos and videos into a ZIP and skips hidden ones', async () => {
    const { wedding } = await makeWedding(ctx.db, { eventDate: new Date('2026-07-04T14:00:00Z') });
    const scope = weddingScope(ctx.db, wedding.id);

    const photo = await scope.media.create({
      kind: 'photo',
      status: 'ready',
      declaredContentType: 'image/jpeg',
      declaredSizeBytes: 5,
      uploaderName: 'Ciocia Zosia',
    });
    const fullKey = mediaStorageKey(wedding.id, photo.id, 'full.jpg');
    await scope.media.update(photo.id, { variants: { full: fullKey } });
    await ctx.memory.put(fullKey, Buffer.from('PHOTO-BYTES'), 'image/jpeg');

    const clip = await scope.media.create({
      kind: 'video',
      status: 'ready',
      declaredContentType: 'video/quicktime',
      declaredSizeBytes: 5,
      videoProvider: 'local',
    });
    const videoKey = mediaStorageKey(wedding.id, clip.id, 'video');
    await scope.media.update(clip.id, { originalKey: videoKey });
    await ctx.memory.put(videoKey, Buffer.from('VIDEO-BYTES'), 'video/quicktime');

    await scope.media.create({
      kind: 'photo',
      status: 'hidden',
      declaredContentType: 'image/jpeg',
      declaredSizeBytes: 5,
    });

    const row = await scope.exports.create(null);
    await exportWedding(ctx, { weddingId: wedding.id, exportId: row.id, notify: true });

    const done = await scope.exports.get(row.id);
    expect(done).toMatchObject({
      status: 'ready',
      mediaCount: 2,
      objectKey: exportKey(wedding.id, row.id),
      error: null,
    });

    const zip = (await ctx.memory.getBuffer(exportKey(wedding.id, row.id))).toString('latin1');
    expect(zip.startsWith('PK')).toBe(true);
    expect(zip).toMatch(/zdjecia\/1_2026-\d\d-\d\d_\d{4}_Ciocia_Zosia\.jpg/);
    expect(zip).toMatch(/filmy\/2_[\d_-]+\.mov/);
    expect(zip).toContain('PHOTO-BYTES');
    expect(zip).toContain('VIDEO-BYTES');
    expect(ctx.mails.some((m) => m.subject.startsWith('Paczka zdjęć gotowa'))).toBe(true);
  });
});
