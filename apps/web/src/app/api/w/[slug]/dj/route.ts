import { guestCanView } from '@vgb/core';
import { hitRateLimit, lockRateLimit, peekRateLimit } from '@vgb/db';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { findWedding, setGuestCookie } from '@/lib/guest';
import {
  crossOriginResponse,
  domainErrorResponse,
  ipKey,
  jsonError,
  readJson,
} from '@/lib/request';
import { db } from '@/lib/server';
import { weddingScope } from '@vgb/db';

export const dynamic = 'force-dynamic';

const WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_IP = 10;

const bodySchema = z.object({
  token: z.string().min(20).max(200),
  displayName: z.string().trim().max(60).optional(),
  acceptTerms: z.literal(true, { message: 'Zaakceptuj regulamin, aby kontynuować.' }),
});

function tooMany(resetAt: Date) {
  const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
  return jsonError(
    429,
    `Zbyt wiele nieudanych prób. Spróbuj ponownie za ${Math.ceil(retryAfter / 60)} min.`,
    { retryAfter },
    { 'Retry-After': String(retryAfter) },
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const forbidden = crossOriginResponse(req);
  if (forbidden) return forbidden;
  try {
    const wedding = await findWedding((await params).slug);
    if (!wedding || wedding.status === 'deleted') return jsonError(404, 'Nie znaleziono galerii.');
    if (!guestCanView(wedding)) return jsonError(403, 'Galeria nie jest teraz otwarta.');

    const parsed = bodySchema.safeParse(await readJson(req));
    if (!parsed.success) {
      return jsonError(400, parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.');
    }

    const limitKey = `dj:ip:${wedding.id}:${ipKey(req)}`;
    const state = await peekRateLimit(db(), limitKey);
    if (state && state.count >= MAX_FAILURES_PER_IP) return tooMany(state.resetAt);

    const tokenHash = createHash('sha256').update(parsed.data.token).digest('hex');
    const scope = weddingScope(db(), wedding.id);
    const link = await scope.djLinks.getActiveByTokenHash(tokenHash);
    if (!link) {
      const hit = await hitRateLimit(db(), limitKey, WINDOW_MS);
      if (hit.count >= MAX_FAILURES_PER_IP) {
        const until = new Date(Date.now() + LOCKOUT_MS);
        await lockRateLimit(db(), limitKey, until);
        return tooMany(until);
      }
      return jsonError(401, 'Link DJ-a jest nieprawidłowy albo został odwołany.');
    }

    const session = await scope.guestSessions.create({
      displayName: parsed.data.displayName || null,
      role: 'dj',
      djLinkId: link.id,
    });
    await setGuestCookie(wedding.id, session.id);
    await scope.audit({
      actorType: 'guest',
      actorId: session.id,
      action: 'dj_link.used',
      targetType: 'wedding_dj_link',
      targetId: link.id,
    });
    return Response.json({ ok: true });
  } catch (err) {
    return domainErrorResponse(err);
  }
}
