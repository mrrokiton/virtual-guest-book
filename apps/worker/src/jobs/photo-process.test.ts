import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { weddingScope } from '@vgb/db';
import { createTestContext, makeWedding, type TestContext } from '../test-utils';
import { heifPixels, processPhoto } from './photo';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

async function processingPhoto(body: Buffer, sizeBytes = body.length) {
  const { wedding } = await makeWedding(ctx.db, { eventDate: new Date() });
  const scope = weddingScope(ctx.db, wedding.id);
  const media = await scope.media.create({
    kind: 'photo',
    status: 'processing',
    declaredContentType: 'image/jpeg',
    declaredSizeBytes: sizeBytes,
    sizeBytes,
    originalKey: `weddings/${wedding.id}/media/p/original`,
  });
  await ctx.memory.put(media.originalKey!, body, 'image/jpeg');
  const job = { weddingId: wedding.id, mediaId: media.id };
  return { scope, media, job, get: () => scope.media.get(media.id) };
}

const jpeg = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: '#c86' } })
    .jpeg()
    .toBuffer();

function box(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, payload]);
}

function ispe(width: number, height: number): Buffer {
  const p = Buffer.alloc(12);
  p.writeUInt32BE(width, 4);
  p.writeUInt32BE(height, 8);
  return box('ispe', p);
}

describe('heifPixels', () => {
  it('reads the largest declared extent without decoding', () => {
    const file = Buffer.concat([
      box('ftyp', Buffer.from('heic\0\0\0\0mif1heic', 'latin1')),
      box('meta', Buffer.concat([Buffer.alloc(4), ispe(512, 512), ispe(8064, 6048)])),
      box('mdat', Buffer.alloc(16)),
    ]);
    expect(heifPixels(file)).toBe(8064 * 6048);
  });

  it('returns null when there is no meta box', () => {
    expect(heifPixels(box('ftyp', Buffer.from('heic', 'latin1')))).toBeNull();
  });
});

describe('processPhoto', () => {
  it('builds variants and drops the original', async () => {
    const p = await processingPhoto(await jpeg());
    await processPhoto(ctx, p.job);
    expect((await p.get())?.status).toBe('ready');
    expect(ctx.memory.objects.has(p.media.originalKey!)).toBe(false);
  });

  it('discards an original that grew after /complete checked it', async () => {
    const p = await processingPhoto(await jpeg(), 10);
    await processPhoto(ctx, p.job);
    expect(await p.get()).toMatchObject({ status: 'failed', failureReason: 'too_large' });
    expect(ctx.memory.objects.has(p.media.originalKey!)).toBe(false);
  });

  it('leaves an item deleted mid-flight alone', async () => {
    const p = await processingPhoto(await jpeg());
    vi.spyOn(ctx.memory, 'getBuffer').mockImplementationOnce(async () => {
      await p.scope.media.update(p.media.id, { status: 'deleted' });
      throw new Error('NoSuchKey');
    });
    await processPhoto(ctx, p.job);
    expect((await p.get())?.status).toBe('deleted');
  });

  it('rethrows transient storage errors so the job is retried', async () => {
    const p = await processingPhoto(await jpeg());
    vi.spyOn(ctx.memory, 'getBuffer').mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(processPhoto(ctx, p.job)).rejects.toThrow('ECONNRESET');
    expect((await p.get())?.status).toBe('processing');
    expect(ctx.memory.objects.has(p.media.originalKey!)).toBe(true);
  });

  it('marks undecodable bytes as failed', async () => {
    const p = await processingPhoto(
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64)]),
    );
    await processPhoto(ctx, p.job);
    expect(await p.get()).toMatchObject({ status: 'failed', failureReason: 'decode_failed' });
  });
});
