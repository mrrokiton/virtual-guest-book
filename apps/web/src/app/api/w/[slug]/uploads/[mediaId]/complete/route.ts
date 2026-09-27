import { detectMedia, planLimits, QUEUES } from '@vgb/core';
import { publishMediaEvent, weddingScope } from '@vgb/db';
import { enqueue } from '@/lib/jobs';
import { resolveGuest } from '@/lib/guest';
import { crossOriginResponse, domainErrorResponse, jsonError } from '@/lib/request';
import { isUuid } from '@/lib/session';
import { db, storage, video } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; mediaId: string }> },
) {
  const forbidden = crossOriginResponse(req);
  if (forbidden) return forbidden;
  try {
    const { slug, mediaId } = await params;
    const guest = await resolveGuest(slug);
    if (!guest) return jsonError(401, 'Sesja wygasła. Podaj PIN ponownie.');
    if (!isUuid(mediaId)) return jsonError(404, 'Nie znaleziono pliku.');

    const scope = weddingScope(db(), guest.wedding.id);
    const media = await scope.media.get(mediaId);
    if (!media || media.guestSessionId !== guest.session.id)
      return jsonError(404, 'Nie znaleziono pliku.');
    if (media.status !== 'uploading') return Response.json({ status: media.status });

    // Cloudflare Stream reports completion through its webhook.
    if (media.kind === 'video' && media.videoProvider === 'cloudflare') {
      await scope.media.update(media.id, { status: 'processing' });
      return Response.json({ status: 'processing' });
    }

    const info = media.originalKey ? await storage().head(media.originalKey) : null;
    if (!info) return jsonError(409, 'Plik nie dotarł na serwer. Spróbuj wysłać go ponownie.');

    const limits = planLimits(guest.wedding.plan);
    const maxBytes = media.kind === 'photo' ? limits.maxPhotoBytes : limits.maxVideoBytes;
    if (info.size > maxBytes) {
      await storage().delete(media.originalKey!);
      await scope.media.update(media.id, { status: 'failed', failureReason: 'too_large' });
      return jsonError(413, 'Plik jest za duży.');
    }

    if (media.kind === 'photo') {
      await scope.media.update(media.id, { status: 'processing', sizeBytes: info.size });
      await enqueue(QUEUES.photoProcess, { weddingId: guest.wedding.id, mediaId: media.id });
      return Response.json({ status: 'processing' });
    }

    const head = await storage().getHead(media.originalKey!, 64);
    if (detectMedia(head)?.kind !== 'video') {
      await storage().delete(media.originalKey!);
      await scope.media.update(media.id, { status: 'failed', failureReason: 'unsupported' });
      return jsonError(415, 'Ten plik nie jest obsługiwanym filmem.');
    }
    await scope.media.update(media.id, {
      status: video().readyOnUpload ? 'ready' : 'processing',
      sizeBytes: info.size,
      readyAt: new Date(),
    });
    await publishMediaEvent(db(), {
      type: 'media.ready',
      weddingId: guest.wedding.id,
      mediaId: media.id,
    });
    return Response.json({ status: 'ready' });
  } catch (err) {
    return domainErrorResponse(err);
  }
}
