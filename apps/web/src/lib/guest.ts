import { createHmac } from 'node:crypto';
import { constantTimeEqual, guestCanView, isValidSlug } from '@vgb/core';
import {
  getMembershipRole,
  getWeddingBySlug,
  weddingScope,
  type GuestSession,
  type Wedding,
} from '@vgb/db';
import { cookies } from 'next/headers';
import { env } from './env';
import { getUser } from './session';
import { db } from './server';

const COOKIE_PREFIX = 'vgb_g_';
export const GUEST_SESSION_MAX_AGE = 60 * 60 * 24 * 180;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

function cookieName(weddingId: string): string {
  return COOKIE_PREFIX + weddingId.replaceAll('-', '');
}

function sign(weddingId: string, sessionId: string): string {
  return createHmac('sha256', env().GUEST_SESSION_SECRET)
    .update(`${weddingId}.${sessionId}`)
    .digest('base64url');
}

export async function setGuestCookie(weddingId: string, sessionId: string): Promise<void> {
  (await cookies()).set(cookieName(weddingId), `${sessionId}.${sign(weddingId, sessionId)}`, {
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: GUEST_SESSION_MAX_AGE,
  });
}

async function readGuestSessionId(weddingId: string): Promise<string | null> {
  const value = (await cookies()).get(cookieName(weddingId))?.value;
  if (!value) return null;
  const [sessionId, sig] = value.split('.');
  if (!sessionId || !sig || !/^[0-9a-f-]{36}$/.test(sessionId)) return null;
  return constantTimeEqual(sig, sign(weddingId, sessionId)) ? sessionId : null;
}

export async function findWedding(slug: string): Promise<Wedding | null> {
  if (!isValidSlug(slug)) return null;
  return getWeddingBySlug(db(), slug);
}

export async function getGuestSession(wedding: Wedding): Promise<GuestSession | null> {
  const id = await readGuestSessionId(wedding.id);
  if (!id) return null;
  const scope = weddingScope(db(), wedding.id);
  const session = await scope.guestSessions.getActive(id);
  if (session && Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await scope.guestSessions.touch(session.id);
  }
  return session;
}

export interface Viewer {
  wedding: Wedding;
  guestSession: GuestSession | null;
  isAdmin: boolean;
}

/**
 * Who may see this wedding's files: a guest with a valid session while the gallery is open to
 * guests, or any wedding member (couple, co-admins) as long as the wedding exists.
 */
export async function resolveViewer(slug: string): Promise<Viewer | null> {
  const wedding = await findWedding(slug);
  if (!wedding || wedding.status === 'deleted') return null;

  if (guestCanView(wedding)) {
    const guestSession = await getGuestSession(wedding);
    if (guestSession) return { wedding, guestSession, isAdmin: false };
  }
  const user = await getUser();
  if (user && (await getMembershipRole(db(), wedding.id, user.id))) {
    return { wedding, guestSession: null, isAdmin: true };
  }
  return null;
}

/** For guest-only endpoints (upload, delete own, live feed). */
export async function resolveGuest(
  slug: string,
): Promise<{ wedding: Wedding; session: GuestSession } | null> {
  const wedding = await findWedding(slug);
  if (!wedding || !guestCanView(wedding)) return null;
  const session = await getGuestSession(wedding);
  return session ? { wedding, session } : null;
}
