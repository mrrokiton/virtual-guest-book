'use client';

const MAX_DIMENSION = 4096;
const JPEG_QUALITY = 0.88;

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

export function contentTypeOf(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  const byExt: Record<string, string> = {
    heic: 'image/heic',
    heif: 'image/heif',
    avif: 'image/avif',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    mov: 'video/quicktime',
    mp4: 'video/mp4',
    webm: 'video/webm',
  };
  return (ext && byExt[ext]) || 'application/octet-stream';
}

/**
 * Downscale and re-encode on the phone before upload: much faster on venue LTE, and it strips
 * EXIF (including GPS). Browsers that can't decode the format (HEIC outside Safari) upload the
 * original and the server converts it.
 */
export async function preparePhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    return blob && blob.size < file.size * 1.2 ? blob : file;
  } catch {
    return file;
  }
}

export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.muted = true;
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null);
    el.onerror = () => done(null);
    setTimeout(() => done(null), 10_000);
    el.src = url;
  });
}

export async function api<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  } catch {
    throw new UploadError('Brak połączenia z internetem.', true);
  }
  if (res.ok) return (await res.json()) as T;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
  throw new UploadError(body.error ?? 'Nie udało się wysłać pliku.', retryable);
}

export type UploadTarget =
  | { method: 'PUT'; url: string; headers: Record<string, string> }
  | { method: 'POST_FORM'; url: string };

export function sendFile(
  target: UploadTarget,
  body: Blob,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method === 'PUT' ? 'PUT' : 'POST', target.url);
    if (target.method === 'PUT') {
      for (const [k, v] of Object.entries(target.headers)) xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new UploadError(
              'Serwer plików odrzucił wysyłkę.',
              xhr.status >= 500 || xhr.status === 403,
            ),
          );
    xhr.onerror = () => reject(new UploadError('Przerwane połączenie podczas wysyłania.', true));
    xhr.ontimeout = () => reject(new UploadError('Przekroczono czas wysyłania.', true));
    if (target.method === 'PUT') xhr.send(body);
    else {
      const form = new FormData();
      form.append('file', body);
      xhr.send(form);
    }
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
