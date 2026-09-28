import { canGuestDeleteMedia, mediaPurgeRequest } from '@vgb/core';
import { publishMediaEvent, weddingScope } from '@vgb/db';
import { enqueue } from '@/lib/jobs';
import { resolveGuest } from '@/lib/guest';
import { crossOriginResponse, domainErrorResponse, jsonError } from '@/lib/request';
import { isUuid } from '@/lib/session';
import { db } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Guests can delete only what they uploaded from this device. */
export async function DELETE(
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
    if (!media || media.status === 'deleted' || !canGuestDeleteMedia(media, guest.session.id)) {
      return jsonError(404, 'Nie znaleziono pliku.');
    }
    const deleted = await scope.media.update(
      media.id,
      { status: 'deleted', deletedAt: new Date() },
      { from: [media.status] },
    );
    if (!deleted) return jsonError(409, 'Plik zmienił się w międzyczasie. Odśwież stronę.');
    await publishMediaEvent(db(), {
      type: 'media.removed',
      weddingId: guest.wedding.id,
      mediaId: media.id,
    });
    await enqueue(...mediaPurgeRequest(guest.wedding.id, media.id));
    await scope.audit({
      actorType: 'guest',
      actorId: guest.session.id,
      action: 'media.guest_delete',
      targetType: 'media',
      targetId: media.id,
    });
    return new Response(null, { status: 204 });
  } catch (err) {
    return domainErrorResponse(err);
  }
}
