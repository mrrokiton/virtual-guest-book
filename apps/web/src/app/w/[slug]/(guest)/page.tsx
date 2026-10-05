import { weddingScope } from '@vgb/db';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GuestShell, headlineOf, openGuest } from '@/components/guest/guest-access';
import { GuestApp } from '@/components/guest/guest-app';
import { findWedding } from '@/lib/guest';
import { db, video } from '@/lib/server';
import { toGalleryItem } from '@/lib/weddings';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const wedding = await findWedding((await params).slug);
  return {
    title: wedding && wedding.status !== 'deleted' ? headlineOf(wedding) : 'Księga gości',
    robots: { index: false, follow: false },
    referrer: 'same-origin',
  };
}

export default async function GuestPage({ params }: Props) {
  const { slug } = await params;
  const opened = await openGuest(slug);
  if (opened.status === 'missing') notFound();
  if (opened.status === 'gated') return opened.node;

  const scope = weddingScope(db(), opened.wedding.id);
  const page = await scope.media.gallery({ cursor: null, limit: 30 });
  const hasVideoThumb = video().name === 'cloudflare';

  return (
    <GuestShell wedding={opened.wedding}>
      <GuestApp
        slug={slug}
        headline={opened.headline}
        canUpload={opened.canUpload}
        uploadClosesAt={opened.wedding.readOnlyAt?.toISOString() ?? null}
        initialItems={page.items.map((m) => toGalleryItem(slug, m, hasVideoThumb))}
        initialCursor={page.nextCursor}
        musicEnabled={opened.musicEnabled}
      />
    </GuestShell>
  );
}
