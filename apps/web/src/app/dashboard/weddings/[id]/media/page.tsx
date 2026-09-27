import { roleCan } from '@vgb/core';
import { weddingScope } from '@vgb/db';
import Link from 'next/link';
import { ModerationGrid, type ModerationItem } from '@/components/moderation-grid';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { requireWeddingAccess } from '@/lib/session';
import { db, video } from '@/lib/server';
import { toGalleryItem } from '@/lib/weddings';

export default async function WeddingMediaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { id } = await params;
  const { cursor } = await searchParams;
  const { wedding, role } = await requireWeddingAccess(id, 'wedding.view');
  const page = await weddingScope(db(), wedding.id).media.adminList({
    cursor: cursor ?? null,
    limit: 60,
  });
  const hasVideoThumb = video().name === 'cloudflare';
  const items: ModerationItem[] = page.items.map((m) => ({
    ...toGalleryItem(wedding.slug, m, hasVideoThumb),
    fullUrl: m.kind === 'photo' ? `/api/w/${wedding.slug}/media/${m.id}/file?v=full` : null,
  }));
  const base = `/dashboard/weddings/${wedding.id}/media`;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Ukryte pliki znikają z galerii gości, ale możesz je przywrócić. Usunięcie jest
        nieodwracalne: plik zostanie trwale skasowany z serwera w ciągu kilku minut.
      </p>
      {items.length === 0 ? (
        <Card className="text-center text-sm text-muted-foreground">
          Goście nie dodali jeszcze żadnych zdjęć ani filmów.
        </Card>
      ) : (
        <ModerationGrid
          weddingId={wedding.id}
          items={items}
          canModerate={roleCan(role, 'media.moderate')}
        />
      )}
      <div className="flex justify-between">
        {cursor ? (
          <Link href={base} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            ← Najnowsze
          </Link>
        ) : (
          <span />
        )}
        {page.nextCursor ? (
          <Link
            href={`${base}?cursor=${encodeURIComponent(page.nextCursor)}`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Starsze →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
