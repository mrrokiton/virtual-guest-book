import { guestCanUpload } from '@vgb/core';
import { resolveGuest } from '@/lib/guest';
import { loadMusicModule } from '@/lib/music';
import { crossOriginResponse, domainErrorResponse, jsonError } from '@/lib/request';
import { isUuid } from '@/lib/session';
import { db } from '@/lib/server';
import { publishMusicChanged, weddingScope } from '@vgb/db';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const forbidden = crossOriginResponse(req);
  if (forbidden) return forbidden;
  try {
    const { slug, id } = await params;
    const guest = await resolveGuest(slug);
    if (!guest) return jsonError(401, 'Sesja wygasła. Podaj PIN ponownie.');
    if (!isUuid(id)) return jsonError(404, 'Nie znaleziono propozycji.');
    const music = await loadMusicModule(guest.wedding.id);
    if (!music) return jsonError(404, 'Propozycje muzyczne są wyłączone.');
    if (!guestCanUpload(guest.wedding, new Date())) {
      return jsonError(409, 'Usuwanie propozycji jest już zamknięte.');
    }
    const scope = weddingScope(db(), guest.wedding.id);
    const deleted = await scope.music.softDelete(id, guest.session.id);
    if (!deleted) return jsonError(404, 'Nie znaleziono propozycji.');
    await scope.audit({
      actorType: 'guest',
      actorId: guest.session.id,
      action: 'music.deleted',
      targetType: 'music_suggestion',
      targetId: id,
    });
    await publishMusicChanged(db(), guest.wedding.id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return domainErrorResponse(err);
  }
}
