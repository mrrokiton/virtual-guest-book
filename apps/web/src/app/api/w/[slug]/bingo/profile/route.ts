import { weddingScope } from '@vgb/db';
import { z } from 'zod';
import { resolveGuest } from '@/lib/guest';
import { crossOriginResponse, jsonError, readJson } from '@/lib/request';
import { db } from '@/lib/server';

const body = z.object({ displayName: z.string().trim().min(1).max(60) });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const forbidden = crossOriginResponse(req);
  if (forbidden) return forbidden;
  const guest = await resolveGuest((await params).slug);
  if (!guest) return jsonError(401, 'Sesja wygasła. Podaj PIN ponownie.');
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(400, 'Podaj imię lub nazwę uczestnika.');
  await weddingScope(db(), guest.wedding.id).guestSessions.setDisplayName(
    guest.session.id,
    parsed.data.displayName,
  );
  return Response.json({ ok: true });
}
