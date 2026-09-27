import { weddingScope } from '@vgb/db';
import { checkWeddingAccess } from '@/lib/session';
import { db, storage } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await checkWeddingAccess((await params).id, 'export.download');
  if (!access) return new Response('Not found', { status: 404 });
  const latest = await weddingScope(db(), access.wedding.id).exports.latest();
  if (!latest || latest.status !== 'ready' || !latest.objectKey) {
    return new Response('Export not ready', { status: 404 });
  }
  const url = await storage().presignGet(latest.objectKey, {
    expiresIn: 15 * 60,
    downloadName: `ksiega-gosci-${latest.createdAt.toISOString().slice(0, 10)}.zip`,
  });
  return Response.redirect(url, 302);
}
