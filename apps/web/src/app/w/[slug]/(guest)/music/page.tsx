import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { GuestShell, headlineOf, openGuest } from '@/components/guest/guest-access';
import { MusicView } from '@/components/guest/music-view';
import { findWedding } from '@/lib/guest';
import { loadMusicPanel } from '@/lib/music';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const wedding = await findWedding((await params).slug);
  const headline = wedding && wedding.status !== 'deleted' ? headlineOf(wedding) : 'Księga gości';
  return {
    title: `Utwory · ${headline}`,
    robots: { index: false, follow: false },
    referrer: 'same-origin',
  };
}

export default async function GuestMusicPage({ params }: Props) {
  const { slug } = await params;
  const opened = await openGuest(slug);
  if (opened.status === 'missing') notFound();
  if (opened.status === 'gated') return opened.node;
  if (!opened.musicEnabled) redirect(`/w/${slug}`);

  const music = await loadMusicPanel(opened.wedding, opened.session.id, opened.session.role);
  if (!music) redirect(`/w/${slug}`);

  return (
    <GuestShell wedding={opened.wedding}>
      <MusicView slug={slug} headline={opened.headline} initial={music} />
    </GuestShell>
  );
}
