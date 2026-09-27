import { createHmac } from 'node:crypto';
import { DomainError, httpStatusFor } from '@vgb/core';
import { env } from './env';

/**
 * Fly's proxy sets Fly-Client-IP and overwrites any client-sent value. Elsewhere the fallbacks
 * are spoofable, which is why PIN guessing is also capped per wedding, independent of IP.
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get('fly-client-ip') ??
    h.get('cf-connecting-ip') ??
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    h.get('x-real-ip') ??
    'unknown'
  );
}

/** Rate-limit keys never store raw IP addresses. */
export function ipKey(req: Request): string {
  return createHmac('sha256', env().GUEST_SESSION_SECRET)
    .update(clientIp(req))
    .digest('base64url')
    .slice(0, 22);
}

export function jsonError(
  status: number,
  error: string,
  extra: Record<string, unknown> = {},
  headers?: HeadersInit,
): Response {
  return Response.json({ error, ...extra }, { status, headers });
}

export function domainErrorResponse(err: unknown): Response {
  if (err instanceof DomainError)
    return jsonError(httpStatusFor(err.code), err.message, { code: err.code });
  console.error(err);
  return jsonError(500, 'Wystąpił błąd serwera. Spróbuj ponownie.');
}

/**
 * Guest endpoints authenticate with a SameSite=Lax cookie, which still rides along on cross-site
 * top-level POSTs. Browsers always send Origin on POST/DELETE; non-browser clients carry no
 * victim cookies, so a missing header is allowed.
 */
export function crossOriginResponse(req: Request): Response | null {
  const origin = req.headers.get('origin');
  if (!origin || origin === new URL(env().APP_URL).origin) return null;
  return jsonError(403, 'Niedozwolone żądanie.');
}

export async function readJson(req: Request, maxBytes = 16 * 1024): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new DomainError('invalid_input', 'Zbyt duże żądanie.');
  try {
    return JSON.parse(text);
  } catch {
    throw new DomainError('invalid_input', 'Nieprawidłowe dane.');
  }
}
