export const MEDIA_KINDS = ['photo', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_STATUSES = [
  'uploading',
  'processing',
  'ready',
  'failed',
  'hidden',
  'deleted',
] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const PHOTO_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
] as const;
export const VIDEO_CONTENT_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;

export function kindForContentType(contentType: string): MediaKind | null {
  if ((PHOTO_CONTENT_TYPES as readonly string[]).includes(contentType)) return 'photo';
  if ((VIDEO_CONTENT_TYPES as readonly string[]).includes(contentType)) return 'video';
  return null;
}

export interface DetectedMedia {
  kind: MediaKind;
  mime: string;
}

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);
const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'dash',
  'mmp4',
]);

function ascii(buf: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...buf.subarray(start, end));
}

function startsWith(buf: Uint8Array, bytes: number[]): boolean {
  return bytes.every((b, i) => buf[i] === b);
}

/**
 * Identify a file from its leading bytes (at least the first 64). The client-declared content type
 * and file extension are never trusted.
 */
export function detectMedia(buf: Uint8Array): DetectedMedia | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { kind: 'photo', mime: 'image/jpeg' };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'photo', mime: 'image/png' };
  }
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') {
    return { kind: 'photo', mime: 'image/webp' };
  }
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'video', mime: 'video/webm' };

  if (buf.length >= 12 && ascii(buf, 4, 8) === 'ftyp') {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const boxSize = Math.min(view.getUint32(0), buf.length);
    const brands = [ascii(buf, 8, 12)];
    for (let i = 16; i + 4 <= boxSize; i += 4) brands.push(ascii(buf, i, i + 4));

    if (brands.some((b) => AVIF_BRANDS.has(b))) return { kind: 'photo', mime: 'image/avif' };
    if (brands.some((b) => HEIF_BRANDS.has(b))) return { kind: 'photo', mime: 'image/heic' };
    if (brands[0] === 'qt  ') return { kind: 'video', mime: 'video/quicktime' };
    if (brands.some((b) => MP4_BRANDS.has(b) || b.startsWith('3gp'))) {
      return { kind: 'video', mime: 'video/mp4' };
    }
  }
  return null;
}

export const PHOTO_VARIANTS = {
  thumb: { maxSize: 400, format: 'webp' },
  large: { maxSize: 1600, format: 'webp' },
  full: { maxSize: 4096, format: 'jpeg' },
} as const;
export type PhotoVariant = keyof typeof PHOTO_VARIANTS;

export function mediaStorageKey(weddingId: string, mediaId: string, name: string): string {
  return `weddings/${weddingId}/media/${mediaId}/${name}`;
}

export function weddingStoragePrefix(weddingId: string): string {
  return `weddings/${weddingId}/`;
}
