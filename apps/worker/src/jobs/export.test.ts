import { EXPORT_SUPERSEDED, mediaStorageKey } from '@vgb/core';
import { weddingScope } from '@vgb/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestContext, makeWedding, type TestContext } from '../test-utils';
import { bingoFolderName, exportKey, exportWedding } from './export';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

describe('exportWedding', () => {
  it('creates collision-proof, portable Bingo folder names', () => {
    expect(
      bingoFolderName({
        id: 'a1b2c3d4-0000-0000-0000-000000000000',
        body: 'Zrób zdjęcie z parą młodą / CON',
        position: 0,
      }),
    ).toBe('01_Zrob_zdjecie_z_para_mloda_CON_a1b2c3d4');
  });

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
    expect(done?.notifiedAt).not.toBeNull();
  });

  it('puts pending and accepted Bingo photos into task folders without gallery copies', async () => {
    const { wedding } = await makeWedding(ctx.db, { eventDate: new Date('2026-07-04T14:00:00Z') });
    const scope = weddingScope(ctx.db, wedding.id);
    const session = await scope.guestSessions.create({ displayName: 'Ola' });
    const task = await scope.bingo.tasks.create('Zdjęcie z parą młodą');
    const upload = await scope.bingo.createUpload({
      taskId: task.id,
      guestSessionId: session.id,
      media: {
        kind: 'photo',
        status: 'ready',
        declaredContentType: 'image/jpeg',
        declaredSizeBytes: 5,
        guestSessionId: session.id,
        uploaderName: 'Ola',
      },
    });
    const fullKey = mediaStorageKey(wedding.id, upload!.media.id, 'full.jpg');
    await scope.media.update(upload!.media.id, { variants: { full: fullKey } });
    await scope.bingo.markSubmitted(upload!.media.id);
    await ctx.memory.put(fullKey, Buffer.from('BINGO-PHOTO'), 'image/jpeg');

    const row = await scope.exports.create(null);
    await exportWedding(ctx, { weddingId: wedding.id, exportId: row.id, notify: false });
    const zip = (await ctx.memory.getBuffer(exportKey(wedding.id, row.id))).toString('latin1');
    expect(zip).toContain(`Bingo/${bingoFolderName(task)}/`);
    expect(zip).toContain('BINGO-PHOTO');
    expect(zip).not.toMatch(/zdjecia\/.*Ola/);
  });

  const readyMail = () => ctx.mails.filter((m) => m.subject.startsWith('Paczka zdjęć gotowa'));

  it('sends the e-mail on retry when the ZIP was built but notifying failed', async () => {
    const { wedding } = await makeWedding(ctx.db, { eventDate: new Date('2026-07-04T14:00:00Z') });
    const scope = weddingScope(ctx.db, wedding.id);
    const row = await scope.exports.create(null);
    const job = { weddingId: wedding.id, exportId: row.id, notify: true };

    const send = vi.spyOn(ctx.boss, 'send').mockRejectedValueOnce(new Error('db down'));
    await expect(exportWedding(ctx, job)).rejects.toThrow('db down');
    send.mockRestore();
    expect((await scope.exports.get(row.id))?.status).toBe('ready');

    const before = readyMail().length;
    await exportWedding(ctx, job);
    expect(readyMail().length).toBe(before + 1);
    await exportWedding(ctx, job);
    expect(readyMail().length).toBe(before + 1);
  });

  it('ignores a late job for an export the owner replaced', async () => {
    const { wedding } = await makeWedding(ctx.db, { eventDate: new Date('2026-07-04T14:00:00Z') });
    const scope = weddingScope(ctx.db, wedding.id);
    const row = await scope.exports.create(null);
    await scope.exports.update(row.id, { status: 'failed', error: EXPORT_SUPERSEDED });

    await exportWedding(ctx, { weddingId: wedding.id, exportId: row.id, notify: true });
    expect(await scope.exports.get(row.id)).toMatchObject({ status: 'failed' });
    expect(ctx.memory.objects.has(exportKey(wedding.id, row.id))).toBe(false);
  });

  it('fails instead of hanging when the upload breaks', async () => {
    const { wedding } = await makeWedding(ctx.db, { eventDate: new Date('2026-07-04T14:00:00Z') });
    const scope = weddingScope(ctx.db, wedding.id);
    const row = await scope.exports.create(null);
    vi.spyOn(ctx.memory, 'putStream').mockRejectedValueOnce(new Error('R2 unavailable'));

    await expect(
      exportWedding(ctx, { weddingId: wedding.id, exportId: row.id, notify: false }),
    ).rejects.toThrow('R2 unavailable');
    expect(await scope.exports.get(row.id)).toMatchObject({ status: 'failed' });
  });
});
