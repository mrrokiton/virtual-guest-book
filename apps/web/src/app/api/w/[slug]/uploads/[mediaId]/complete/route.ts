import { detectMedia, planLimits, QUEUES } from '@vgb/core';
import { publishMediaEvent, weddingScope } from '@vgb/db';
import { enqueue } from '@/lib/jobs';
import { resolveGuest } from '@/lib/guest';
import { crossOriginResponse, domainErrorResponse, jsonError } from '@/lib/request';
import { isUuid } from '@/lib/session';
import { db, storage } from '@/lib/server';

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
    const processPhoto = () =>
      enqueue(
        QUEUES.photoProcess,
        { weddingId: guest.wedding.id, mediaId: media.id },
        { singletonKey: media.id },
      );
    if (media.status !== 'uploading') {
      // A retry after the status flipped but the enqueue failed must not strand the photo.
      if (media.kind === 'photo' && media.status === 'processing') await processPhoto();
      return Response.json({ status: media.status });
    }
    const current = async () => (await scope.media.get(media.id))?.status ?? 'deleted';

    // Cloudflare Stream reports completion through its webhook, which may already have arrived.
    if (media.kind === 'video' && media.videoProvider === 'cloudflare') {
      const row = await scope.media.update(
        media.id,
        { status: 'processing' },
        { from: ['uploading'] },
      );
      return Response.json({ status: row ? 'processing' : await current() });
    }

    const info = media.originalKey ? await storage().head(media.originalKey) : null;
    if (!info) return jsonError(409, 'Plik nie dotarł na serwer. Spróbuj wysłać go ponownie.');

    const limits = planLimits(guest.wedding.plan);
    const maxBytes = media.kind === 'photo' ? limits.maxPhotoBytes : limits.maxVideoBytes;
    if (info.size > maxBytes) {
      await storage().delete(media.originalKey!);
      await scope.media.update(
        media.id,
        { status: 'failed', failureReason: 'too_large' },
        { from: ['uploading'] },
      );
      return jsonError(413, 'Plik jest za duży.');
    }

    if (media.kind === 'photo') {
      const row = await scope.media.update(
        media.id,
        { status: 'processing', sizeBytes: info.size },
        { from: ['uploading'] },
      );
      if (!row) return Response.json({ status: await current() });
      await processPhoto();
      return Response.json({ status: 'processing' });
    }

    const head = await storage().getHead(media.originalKey!, 64);
    if (detectMedia(head)?.kind !== 'video') {
      await storage().delete(media.originalKey!);
      await scope.media.update(
        media.id,
        { status: 'failed', failureReason: 'unsupported' },
        { from: ['uploading'] },
      );
      return jsonError(415, 'Ten plik nie jest obsługiwanym filmem.');
    }
    const row = await scope.media.update(
      media.id,
      { status: 'ready', sizeBytes: info.size, readyAt: new Date() },
      { from: ['uploading'] },
    );
    if (!row) return Response.json({ status: await current() });
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
