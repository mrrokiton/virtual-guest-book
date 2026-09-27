import { NextResponse, type NextRequest } from 'next/server';

function origin(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

function contentSecurityPolicy(): string {
  const storage = origin(process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT);
  const stream =
    'https://*.cloudflarestream.com https://upload.videodelivery.net https://*.videodelivery.net';
  const dev = process.env.NODE_ENV !== 'production';
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${storage ?? ''} ${stream}`,
    `media-src 'self' blob: ${storage ?? ''} ${stream}`,
    `connect-src 'self' ${storage ?? ''} ${stream}${dev ? ' ws:' : ''}`,
    `frame-src ${stream}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function proxy(req: NextRequest) {
  const res = NextResponse.next();
  res.headers.set('Content-Security-Policy', contentSecurityPolicy());
  const path = req.nextUrl.pathname;
  if (
    path.startsWith('/w/') ||
    path.startsWith('/api/') ||
    path.startsWith('/dashboard') ||
    path.startsWith('/invite')
  ) {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
