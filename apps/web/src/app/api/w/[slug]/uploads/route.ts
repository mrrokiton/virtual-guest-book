import {
  DomainError,
  guestCanUpload,
  kindForContentType,
  mediaStorageKey,
  planLimits,
} from '@vgb/core';
import { hitRateLimit, weddingScope } from '@vgb/db';
import { z } from 'zod';
import { resolveGuest } from '@/lib/guest';
import { crossOriginResponse, domainErrorResponse, jsonError, readJson } from '@/lib/request';
import { db, storage, video } from '@/lib/server';

export const dynamic = 'force-dynamic';

const MAX_UPLOADS_PER_SESSION = 150;
const UPLOAD_WINDOW_MS = 10 * 60 * 1000;
/** Clients report duration from the file's metadata; allow for rounding. */
const DURATION_TOLERANCE_S = 1.5;
/**
 * The client PUTs right after receiving the URL and asks for a new one on retry. Short, because
 * the URL could otherwise replace the object after /complete checked its size.
 */
const PHOTO_PUT_TTL_SECONDS = 5 * 60;

const body = z.object({
  contentType: z.string().max(100),
  size: z.number().int().positive(),
  durationSeconds: z.number().positive().max(3600).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const forbidden = crossOriginResponse(req);
  if (forbidden) return forbidden;
  try {
    const guest = await resolveGuest((await params).slug);
    if (!guest) return jsonError(401, 'Sesja wygasła. Podaj PIN ponownie.');
    const { wedding, session } = guest;
    if (!guestCanUpload(wedding, new Date()))
      return jsonError(409, 'Dodawanie zdjęć jest już zamknięte.');

    const parsed = body.safeParse(await readJson(req));
    if (!parsed.success) return jsonError(400, 'Nieprawidłowe dane pliku.');
    const { contentType, size, durationSeconds } = parsed.data;

    const kind = kindForContentType(contentType);
    if (!kind) throw new DomainError('unsupported_media', 'Ten format pliku nie jest obsługiwany.');

    const limits = planLimits(wedding.plan);
    const scope = weddingScope(db(), wedding.id);
    const usage = await scope.media.usage();
    if (usage.total >= limits.maxMediaPerWedding) {
      throw new DomainError('limit_exceeded', 'Galeria osiągnęła limit plików.');
    }
    if (kind === 'photo' && size > limits.maxPhotoBytes) {
      throw new DomainError(
        'limit_exceeded',
        `Zdjęcie jest za duże (max ${limits.maxPhotoBytes / 1024 / 1024} MB).`,
      );
    }
    if (kind === 'video') {
      if (usage.videos >= limits.maxVideosPerWedding)
        throw new DomainError('limit_exceeded', 'Galeria osiągnęła limit filmów.');
      if (size > limits.maxVideoBytes) {
        throw new DomainError(
          'limit_exceeded',
          `Film jest za duży (max ${limits.maxVideoBytes / 1024 / 1024} MB).`,
        );
      }
      if (!durationSeconds || durationSeconds > limits.maxVideoSeconds + DURATION_TOLERANCE_S) {
        throw new DomainError(
          'limit_exceeded',
          `Film może trwać maksymalnie ${limits.maxVideoSeconds} s.`,
        );
      }
    }

    const rate = await hitRateLimit(db(), `upload:${session.id}`, UPLOAD_WINDOW_MS);
    if (rate.count > MAX_UPLOADS_PER_SESSION) {
      throw new DomainError(
        'rate_limited',
        'Wysyłasz bardzo dużo plików naraz. Odczekaj kilka minut.',
      );
    }

    const media = await scope.media.create({
      kind,
      status: 'uploading',
      declaredContentType: contentType,
      declaredSizeBytes: size,
      durationSeconds: durationSeconds ?? null,
      guestSessionId: session.id,
      uploaderName: session.displayName,
    });

    if (kind === 'photo') {
      const key = mediaStorageKey(wedding.id, media.id, 'upload');
      await scope.media.update(media.id, { originalKey: key });
      return Response.json({
        mediaId: media.id,
        upload: {
          method: 'PUT',
          url: await storage().presignPut(key, contentType, PHOTO_PUT_TTL_SECONDS),
          headers: { 'Content-Type': contentType },
        },
      });
    }

    const upload = await video().createUpload({
      weddingId: wedding.id,
      mediaId: media.id,
      contentType,
      maxDurationSeconds: limits.maxVideoSeconds,
    });
    await scope.media.update(media.id, {
      videoProvider: video().name,
      videoUid: upload.videoUid,
      originalKey: upload.originalKey,
    });
    return Response.json({
      mediaId: media.id,
      upload:
        upload.method === 'PUT'
          ? { method: 'PUT', url: upload.url, headers: { 'Content-Type': contentType } }
          : { method: 'POST_FORM', url: upload.url },
    });
  } catch (err) {
    return domainErrorResponse(err);
  }
}
