import {
  detectMedia,
  mediaStorageKey,
  PHOTO_VARIANTS,
  type PhotoProcessJob,
  type PhotoVariant,
} from '@vgb/core';
import { publishMediaEvent, weddingScope } from '@vgb/db';
import heicConvert from 'heic-convert';
import sharp from 'sharp';
import type { Context } from '../context';

/** Refuse decompression bombs: ~100 MP is well above any phone camera. */
const MAX_INPUT_PIXELS = 100_000_000;

interface Encoded {
  name: PhotoVariant;
  data: Buffer;
  contentType: string;
  ext: string;
  width: number;
  height: number;
}

async function decodeable(buf: Buffer): Promise<Buffer | null> {
  const detected = detectMedia(buf);
  if (detected?.kind !== 'photo') return null;
  // libvips prebuilt binaries ship without an HEVC decoder, so HEIC goes through heic-convert.
  if (detected.mime === 'image/heic' || detected.mime === 'image/heif') {
    return Buffer.from(await heicConvert({ buffer: buf, format: 'JPEG', quality: 0.92 }));
  }
  return buf;
}

/** Pure CPU work on a local buffer: any failure here means the file itself is unusable. */
export async function encodeVariants(original: Buffer): Promise<Encoded[] | null> {
  try {
    const input = await decodeable(original);
    if (!input) return null;
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
  } catch {
    return null;
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

  const original = await ctx.storage.getBuffer(media.originalKey).catch(async (err: unknown) => {
    // Deleted by the guest or a moderator mid-flight: the purge job already removed the upload.
    if ((await scope.media.get(media.id))?.status !== 'processing') return null;
    throw err;
  });
  if (!original) return;

  const encoded = await encodeVariants(original);
  if (!encoded) {
    await ctx.storage.delete(media.originalKey);
    await scope.media.update(media.id, {
      status: 'failed',
      failureReason: 'decode_failed',
      originalKey: null,
      purgedAt: ctx.now(),
    });
    return;
  }

  const variants: Partial<Record<PhotoVariant, string>> = {};
  for (const v of encoded) {
    const key = mediaStorageKey(job.weddingId, media.id, `${v.name}.${v.ext}`);
    await ctx.storage.put(key, v.data, v.contentType);
    variants[v.name] = key;
  }
  const full = encoded.find((v) => v.name === 'full');

  const current = await scope.media.get(media.id);
  if (!current || current.status !== 'processing') {
    await Promise.all(Object.values(variants).map((k) => ctx.storage.delete(k)));
    return;
  }
  await scope.media.update(media.id, {
    status: 'ready',
    variants,
    width: full?.width ?? null,
    height: full?.height ?? null,
    readyAt: ctx.now(),
    originalKey: null,
  });
  await ctx.storage.delete(media.originalKey);
  await publishMediaEvent(ctx.db, {
    type: 'media.ready',
    weddingId: job.weddingId,
    mediaId: media.id,
  });
}
