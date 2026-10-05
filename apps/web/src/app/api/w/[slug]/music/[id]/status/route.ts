import { guestCanUpload, isMusicStatus } from '@vgb/core';
import { weddingScope } from '@vgb/db';
import { z } from 'zod';
import { resolveGuest } from '@/lib/guest';
import { loadMusicModule, toMusicEntry } from '@/lib/music';
import { crossOriginResponse, domainErrorResponse, jsonError, readJson } from '@/lib/request';
import { db } from '@/lib/server';
import { isUuid } from '@/lib/session';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ status: z.string() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const forbidden = crossOriginResponse(req);
  if (forbidden) return forbidden;
  try {
    const { slug, id } = await params;
    const guest = await resolveGuest(slug);
    if (!guest) return jsonError(401, 'Sesja wygasła. Podaj PIN ponownie.');
    if (guest.session.role !== 'dj') return jsonError(403, 'Tylko DJ może zmieniać status.');
    if (!isUuid(id)) return jsonError(404, 'Nie znaleziono propozycji.');
    const music = await loadMusicModule(guest.wedding.id);
    if (!music) return jsonError(404, 'Propozycje muzyczne są wyłączone.');
    if (!guestCanUpload(guest.wedding, new Date())) {
      return jsonError(409, 'Zmiana statusu jest już zamknięta.');
    }
    const parsed = bodySchema.safeParse(await readJson(req));
    if (!parsed.success || !isMusicStatus(parsed.data.status)) {
      return jsonError(400, 'Nieprawidłowy status.');
    }
    const scope = weddingScope(db(), guest.wedding.id);
    const row = await scope.music.setStatus(id, parsed.data.status);
    if (!row) return jsonError(409, 'Propozycja zmieniła się w międzyczasie. Odśwież stronę.');
    await scope.audit({
      actorType: 'guest',
      actorId: guest.session.id,
      action: 'music.status',
      targetType: 'music_suggestion',
      targetId: id,
      metadata: { status: parsed.data.status },
    });
    return Response.json(toMusicEntry(row, guest.session.id));
  } catch (err) {
    return domainErrorResponse(err);
  }
}
