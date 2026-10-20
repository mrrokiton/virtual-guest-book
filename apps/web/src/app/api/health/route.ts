export const dynamic = 'force-dynamic';

/**
 * Liveness for Fly's 15-second check. It must not query Postgres, or Neon could never scale to
 * zero. The database check lives at /api/health/db.
 */
export function GET() {
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
