import { pingDatabase } from '@vgb/db';
import { db } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Manual diagnosis only: every call wakes Neon, so do not point a frequent uptime check here. */
export async function GET() {
  try {
    await pingDatabase(db());
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
