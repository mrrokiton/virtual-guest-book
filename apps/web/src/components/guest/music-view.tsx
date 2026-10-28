'use client';

import type { MusicPanelData } from '@/lib/music';
import { GuestHeader, GuestSessionLost } from './guest-header';
import type { LiveWindow } from './live-schedule';
import { MusicPanel } from './music-panel';
import { useLiveMusic } from './use-live-music';

export function MusicView({
  slug,
  headline,
  liveWindow,
  initial,
  bingoEnabled,
}: {
  slug: string;
  headline: string;
  liveWindow: LiveWindow;
  initial: MusicPanelData;
  bingoEnabled: boolean;
}) {
  const live = useLiveMusic(slug, liveWindow, initial);
  if (live.sessionLost) return <GuestSessionLost />;
  return (
    <div className="pb-10">
      <GuestHeader
        slug={slug}
        headline={headline}
        section="music"
        musicEnabled
        bingoEnabled={bingoEnabled}
        degraded={live.mode === 'polling'}
      />
      <MusicPanel slug={slug} data={live.data} reload={live.refresh} moduleOff={live.moduleOff} />
    </div>
  );
}
