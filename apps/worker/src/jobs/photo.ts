import {
  detectMedia,
  mediaStorageKey,
  PHOTO_VARIANTS,
  type PhotoProcessJob,
  type PhotoVariant,
} from '@vgb/core';
import { publishMediaEvent, weddingScope } from '@vgb/db';
import { ObjectTooLargeError } from '@vgb/services';
import heicConvert from 'heic-convert';
import sharp from 'sharp';
import type { Context } from '../context';

/** Refuse decompression bombs: ~100 MP is well above any phone camera. */
const MAX_INPUT_PIXELS = 100_000_000;
/**
 * heic-convert decodes the whole image to RGBA in JS before sharp's limit applies, so HEIC gets a
 * lower cap (48 MP iPhones fit) that one worker can hold in memory.
 */
const MAX_HEIC_PIXELS = 50_000_000;
/** libvips and heic-decode messages that mean the bytes are not a usable image. */
const INPUT_ERROR =
  /unsupported image format|corrupt|premature end|exceeds pixel limit|Vips(Jpeg|Png|ForeignLoad)|load_buffer|bad seek|not a HEIC|HEIF image not found/i;

interface Encoded {
  name: PhotoVariant;
  data: Buffer;
  contentType: string;
  ext: string;
  width: number;
  height: number;
}

class UnusableImage extends Error {}

/**
 * Largest `ispe` (image spatial extent) property in the top-level `meta` box, read without
 * decoding. For grid images this is the declared full size, however small the tiles are.
 */
export function heifPixels(buf: Buffer): number | null {
  let off = 0;
  while (off + 8 <= buf.length) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let header = 8;
    if (size === 1) {
      if (off + 16 > buf.length) return null;
      size = Number(buf.readBigUInt64BE(off + 8));
      header = 16;
    } else if (size === 0) {
      size = buf.length - off;
    }
    if (size < header) return null;
    if (type === 'meta') {
      const end = Math.min(off + size, buf.length);
      let max = 0;
      // ispe box: size(4) 'ispe' version+flags(4) width(4) height(4)
      for (
        let i = buf.indexOf('ispe', off, 'latin1');
        i !== -1 && i + 16 <= end;
        i = buf.indexOf('ispe', i + 4, 'latin1')
      ) {
        max = Math.max(max, buf.readUInt32BE(i + 8) * buf.readUInt32BE(i + 12));
      }
      return max || null;
    }
    off += size;
  }
  return null;
}

let heicQueue: Promise<unknown> = Promise.resolve();

/** One HEIC decode at a time: each can take hundreds of MB of heap. */
function oneHeicAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = heicQueue.then(fn, fn);
  heicQueue = run.catch(() => {});
  return run;
}

async function decodeable(buf: Buffer): Promise<Buffer> {
  const detected = detectMedia(buf);
  if (detected?.kind !== 'photo') throw new UnusableImage('not a photo');
  // libvips prebuilt binaries ship without an HEVC decoder, so HEIC goes through heic-convert.
  if (detected.mime === 'image/heic' || detected.mime === 'image/heif') {
    const pixels = heifPixels(buf);
    if (!pixels || pixels > MAX_HEIC_PIXELS) throw new UnusableImage(`HEIC of ${pixels} pixels`);
    return Buffer.from(
      await oneHeicAtATime(() => heicConvert({ buffer: buf, format: 'JPEG', quality: 0.92 })),
    );
  }
  return buf;
}

/**
 * Returns null when the file itself is unusable. Anything else (memory pressure, a crashed
 * decoder) throws so the job is retried instead of discarding a guest's photo.
 */
export async function encodeVariants(original: Buffer): Promise<Encoded[] | null> {
  try {
    const input = await decodeable(original);
    const out: Encoded[] = [];
    for (const [name, spec] of Object.entries(PHOTO_VARIANTS) as [
      PhotoVariant,
      (typeof PHOTO_VARIANTS)[PhotoVariant],
    ][]) {
      const pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate()
        .resize({
          width: spec.maxSize,
          height: spec.maxSize,
          fit: 'inside',
          withoutEnlargement: true,
        });
      const webp = spec.format === 'webp';
      const { data, info } = await (
        webp ? pipeline.webp({ quality: 80 }) : pipeline.jpeg({ quality: 88, mozjpeg: true })
      ).toBuffer({
        resolveWithObject: true,
      });
      out.push({
        name,
        data,
        contentType: webp ? 'image/webp' : 'image/jpeg',
        ext: webp ? 'webp' : 'jpg',
        width: info.width,
        height: info.height,
      });
    }
    return out;
  } catch (err) {
    if (err instanceof UnusableImage || (err instanceof Error && INPUT_ERROR.test(err.message)))
      return null;
    throw err;
  }
}

/**
 * Builds the variants guests actually download. Every variant is re-encoded without metadata, so
 * EXIF (including GPS) never leaves the worker; the uploaded original is deleted afterwards.
 */
export async function processPhoto(ctx: Context, job: PhotoProcessJob): Promise<void> {
  const scope = weddingScope(ctx.db, job.weddingId);
  const media = await scope.media.get(job.mediaId);
  if (!media || media.status !== 'processing' || media.kind !== 'photo' || !media.originalKey)
    return;
  const originalKey = media.originalKey;

  const discard = async (failureReason: string) => {
    await ctx.storage.delete(originalKey);
    await scope.media.update(
      media.id,
      { status: 'failed', failureReason, originalKey: null, purgedAt: ctx.now() },
      { from: ['processing'] },
    );
  };

  let original: Buffer;
  try {
    // /complete checked this size; a presigned PUT replayed afterwards must not change it.
    original = await ctx.storage.getBuffer(originalKey, {
      maxBytes: media.sizeBytes ?? media.declaredSizeBytes,
    });
  } catch (err) {
    if (err instanceof ObjectTooLargeError) return discard('too_large');
    // Deleted by the guest or a moderator mid-flight: the purge job already removed the upload.
    if ((await scope.media.get(media.id))?.status !== 'processing') return;
    if (!(await ctx.storage.head(originalKey))) return discard('missing_original');
    throw err;
  }

  const encoded = await encodeVariants(original);
  if (!encoded) return discard('decode_failed');

  const variants: Partial<Record<PhotoVariant, string>> = {};
  for (const v of encoded) {
    const key = mediaStorageKey(job.weddingId, media.id, `${v.name}.${v.ext}`);
    await ctx.storage.put(key, v.data, v.contentType);
    variants[v.name] = key;
  }
  const full = encoded.find((v) => v.name === 'full');

  // Conditional, so a delete that lands while we encode is not overwritten back to `ready`.
  const ready = await scope.media.update(
    media.id,
    {
      status: 'ready',
      variants,
      width: full?.width ?? null,
      height: full?.height ?? null,
      readyAt: ctx.now(),
      originalKey: null,
    },
    { from: ['processing'] },
  );
  if (!ready) {
    await Promise.all(Object.values(variants).map((k) => ctx.storage.delete(k)));
    return;
  }
  await ctx.storage.delete(originalKey);
  await publishMediaEvent(ctx.db, {
    type: 'media.ready',
    weddingId: job.weddingId,
    mediaId: media.id,
  });
}
