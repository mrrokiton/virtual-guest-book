import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { GuestShell, headlineOf, openGuest } from '@/components/guest/guest-access';
import { BingoView } from '@/components/guest/bingo-view';
import { loadGuestBingo } from '@/lib/bingo';
import { findWedding, liveWindowOf } from '@/lib/guest';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const wedding = await findWedding((await params).slug);
  const headline = wedding && wedding.status !== 'deleted' ? headlineOf(wedding) : 'Księga gości';
  return {
    title: `Bingo · ${headline}`,
    robots: { index: false, follow: false },
    referrer: 'same-origin',
  };
}

export default async function GuestBingoPage({ params }: Props) {
  const { slug } = await params;
  const opened = await openGuest(slug);
  if (opened.status === 'missing') notFound();
  if (opened.status === 'gated') return opened.node;
  if (!opened.bingoEnabled) redirect(`/w/${slug}`);
  const data = await loadGuestBingo(opened.wedding, opened.session, slug);
  return (
    <GuestShell wedding={opened.wedding}>
      <BingoView
        slug={slug}
        headline={opened.headline}
        liveWindow={liveWindowOf(opened.wedding)}
        initial={data}
        musicEnabled={opened.musicEnabled}
      />
    </GuestShell>
  );
}
