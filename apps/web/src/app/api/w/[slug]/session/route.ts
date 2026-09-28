import { constantTimeEqual, guestCanView, normalizePin } from '@vgb/core';
import { hitRateLimit, lockRateLimit, peekRateLimit, weddingScope } from '@vgb/db';
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
/** A device that used up its attempts waits this long after the last one. */
const LOCKOUT_MS = 15 * 60 * 1000;
/** Failed attempts per device per wedding, and per wedding overall (distributed guessing). */
const MAX_FAILURES_PER_IP = 10;
const MAX_FAILURES_PER_WEDDING = 300;
/**
 * New guest sessions per IP per wedding. Guests on the venue Wi-Fi share one address, so this
 * only stops scripted session minting, which would otherwise bypass the per-session SSE cap.
 */
const MAX_SESSIONS_PER_IP = 100;

function tooManyAttempts(resetAt: Date, message: string) {
  const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
  return jsonError(
    429,
    `${message} Spróbuj ponownie za ${Math.ceil(retryAfter / 60)} min.`,
    { retryAfter },
    { 'Retry-After': String(retryAfter) },
  );
}

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
    if (blocked) return tooManyAttempts(blocked.resetAt, 'Zbyt wiele nieudanych prób.');

    if (!constantTimeEqual(normalizePin(parsed.data.pin), weddingPin(wedding))) {
      const [ip] = await Promise.all([
        hitRateLimit(db(), ipLimitKey, WINDOW_MS),
        hitRateLimit(db(), weddingLimitKey, WINDOW_MS),
      ]);
      if (ip.count >= MAX_FAILURES_PER_IP) {
        const until = new Date(Date.now() + LOCKOUT_MS);
        await lockRateLimit(db(), ipLimitKey, until);
        return tooManyAttempts(until, 'Zbyt wiele nieudanych prób.');
      }
      return jsonError(401, 'Nieprawidłowy PIN.', {
        remaining: MAX_FAILURES_PER_IP - ip.count,
      });
    }

    const sessions = await hitRateLimit(db(), `pin:ok:ip:${wedding.id}:${ipKey(req)}`, WINDOW_MS);
    if (sessions.count > MAX_SESSIONS_PER_IP) {
      return tooManyAttempts(sessions.resetAt, 'Zbyt wiele wejść z tej sieci.');
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
