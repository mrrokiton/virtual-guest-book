import { weddingScope } from '@vgb/db';
import { resolveViewer } from '@/lib/guest';
import { domainErrorResponse, jsonError } from '@/lib/request';
import { isUuid } from '@/lib/session';
import { db, storage, video } from '@/lib/server';

export const dynamic = 'force-dynamic';

const URL_TTL_SECONDS = 10 * 60;

/**
 * Authorizes every file access, then redirects to a short-lived signed URL. The bucket itself is
 * private, so a copied storage URL stops working after a few minutes.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; mediaId: string }> },
) {
  try {
    const { slug, mediaId } = await params;
    const viewer = await resolveViewer(slug);
    if (!viewer || !isUuid(mediaId)) return jsonError(404, 'Nie znaleziono pliku.');

    const media = await weddingScope(db(), viewer.wedding.id).media.get(mediaId);
    const visible =
      media && (media.status === 'ready' || (viewer.isAdmin && media.status === 'hidden'));
    if (!media || !visible) return jsonError(404, 'Nie znaleziono pliku.');

    const variant = new URL(req.url).searchParams.get('v') ?? 'large';
    let url: string | null = null;

    if (media.kind === 'photo') {
      const key =
        variant === 'thumb' || variant === 'large' || variant === 'full'
          ? media.variants[variant]
          : undefined;
      url = key ? await storage().presignGet(key, { expiresIn: URL_TTL_SECONDS }) : null;
    } else {
      const ref = { ...media };
      if (variant === 'thumb') url = await video().thumbnailUrl(ref);
      else if (variant === 'play') {
        const playback = await video().playback(ref);
        return playback
          ? Response.json(playback, { headers: { 'Cache-Control': 'private, no-store' } })
          : jsonError(404, 'Film niedostępny.');
      }
    }
    if (!url) return jsonError(404, 'Nie znaleziono pliku.');

    return new Response(null, {
      status: 302,
      headers: { Location: url, 'Cache-Control': `private, max-age=${URL_TTL_SECONDS - 60}` },
    });
  } catch (err) {
    return domainErrorResponse(err);
  }
}
