'use client';

import type { MusicPanelData } from '@/lib/music';
import { GuestHeader, GuestSessionLost } from './guest-header';
import { MusicPanel } from './music-panel';
import { useLiveMusic } from './use-live-music';

export function MusicView({
  slug,
  headline,
  initial,
}: {
  slug: string;
  headline: string;
  initial: MusicPanelData;
}) {
  const live = useLiveMusic(slug, initial);
  if (live.sessionLost) return <GuestSessionLost />;
  return (
    <div className="pb-10">
      <GuestHeader
        slug={slug}
        headline={headline}
        section="music"
        musicEnabled
        degraded={live.mode === 'polling'}
      />
      <MusicPanel slug={slug} data={live.data} reload={live.refresh} moduleOff={live.moduleOff} />
    </div>
  );
}
