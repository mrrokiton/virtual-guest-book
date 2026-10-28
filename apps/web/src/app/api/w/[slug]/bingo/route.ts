import { BINGO_MODULE_KEY } from '@vgb/core';
import { weddingScope } from '@vgb/db';
import { loadGuestBingo } from '@/lib/bingo';
import { resolveGuest } from '@/lib/guest';
import { jsonError } from '@/lib/request';
import { db } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guest = await resolveGuest(slug);
  if (!guest) return jsonError(401, 'Sesja wygasła. Podaj PIN ponownie.');
  const scope = weddingScope(db(), guest.wedding.id);
  if (!(await scope.modules.isEnabled(BINGO_MODULE_KEY))) {
    return jsonError(404, 'Bingo nie jest aktywne.');
  }
  return Response.json(await loadGuestBingo(guest.wedding, guest.session, slug));
}
