import { weddingScope } from '@vgb/db';
import { resolveViewer } from '@/lib/guest';
import { domainErrorResponse, jsonError } from '@/lib/request';
import { db, video } from '@/lib/server';
import { toGalleryItem } from '@/lib/weddings';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const viewer = await resolveViewer(slug);
    if (!viewer) return jsonError(401, 'Brak dostępu.');
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 30) || 30, 60);
    const page = await weddingScope(db(), viewer.wedding.id).media.gallery({
      cursor: url.searchParams.get('cursor'),
      limit,
    });
    const hasVideoThumb = video().name === 'cloudflare';
    return Response.json(
      {
        items: page.items.map((m) => toGalleryItem(slug, m, hasVideoThumb)),
        nextCursor: page.nextCursor,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    return domainErrorResponse(err);
  }
}
