import { constantTimeEqual, guestCanView, normalizePin } from '@vgb/core';
import { hitRateLimit, peekRateLimit, weddingScope } from '@vgb/db';
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
import { weddingPin } from '@/lib/weddings';

export const dynamic = 'force-dynamic';

const WINDOW_MS = 15 * 60 * 1000;
/** Failed attempts per device per wedding, and per wedding overall (distributed guessing). */
const MAX_FAILURES_PER_IP = 10;
const MAX_FAILURES_PER_WEDDING = 300;

const body = z.object({
  pin: z.string().max(20),
  displayName: z.string().trim().max(60).optional(),
  acceptTerms: z.literal(true, { message: 'Zaakceptuj regulamin, aby kontynuować.' }),
});

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const forbidden = crossOriginResponse(req);
  if (forbidden) return forbidden;
  try {
    const wedding = await findWedding((await params).slug);
    if (!wedding || wedding.status === 'deleted') return jsonError(404, 'Nie znaleziono galerii.');
    if (wedding.status === 'draft') return jsonError(403, 'Galeria nie została jeszcze otwarta.');
    if (!guestCanView(wedding)) return jsonError(410, 'Galeria jest już zamknięta.');

    const parsed = body.safeParse(await readJson(req));
    if (!parsed.success)
      return jsonError(400, parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.');

    const ipLimitKey = `pin:ip:${wedding.id}:${ipKey(req)}`;
    const weddingLimitKey = `pin:w:${wedding.id}`;
    const [ipState, weddingState] = await Promise.all([
      peekRateLimit(db(), ipLimitKey),
      peekRateLimit(db(), weddingLimitKey),
    ]);
    const blocked = [
      ipState && ipState.count >= MAX_FAILURES_PER_IP ? ipState : null,
      weddingState && weddingState.count >= MAX_FAILURES_PER_WEDDING ? weddingState : null,
    ].find(Boolean);
    if (blocked) {
      const retryAfter = Math.max(1, Math.ceil((blocked.resetAt.getTime() - Date.now()) / 1000));
      return jsonError(
        429,
        'Zbyt wiele nieudanych prób. Spróbuj ponownie za kilka minut.',
        { retryAfter },
        { 'Retry-After': String(retryAfter) },
      );
    }

    if (!constantTimeEqual(normalizePin(parsed.data.pin), weddingPin(wedding))) {
      const [ip] = await Promise.all([
        hitRateLimit(db(), ipLimitKey, WINDOW_MS),
        hitRateLimit(db(), weddingLimitKey, WINDOW_MS),
      ]);
      return jsonError(401, 'Nieprawidłowy PIN.', {
        remaining: Math.max(0, MAX_FAILURES_PER_IP - ip.count),
      });
    }

    const session = await weddingScope(db(), wedding.id).guestSessions.create({
      displayName: parsed.data.displayName || null,
    });
    await setGuestCookie(wedding.id, session.id);
    return Response.json({ ok: true });
  } catch (err) {
    return domainErrorResponse(err);
  }
}
