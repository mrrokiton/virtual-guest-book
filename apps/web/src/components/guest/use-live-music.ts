'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MusicPanelData } from '@/lib/music';
import type { LiveWindow } from './live-schedule';
import { useLiveUpdates } from './use-live-updates';

export function useLiveMusic(slug: string, liveWindow: LiveWindow, initial: MusicPanelData) {
  const [data, setData] = useState(initial);
  const [sessionLost, setSessionLost] = useState(false);
  const [moduleOff, setModuleOff] = useState(false);
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let res: Response | null;
    try {
      res = await fetch(`/api/w/${slug}/music`, {
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch {
      return;
    }
    if (id !== requestId.current) return;
    if (res?.status === 401) {
      setSessionLost(true);
      return;
    }
    // Module turned off: keep the list and the draft. The form hides separately.
    if (res?.status === 404) {
      setModuleOff(true);
      return;
    }
    if (!res?.ok) return;
    const next = (await res.json()) as MusicPanelData;
    if (id !== requestId.current) return;
    setModuleOff(false);
    setData(next);
  }, [slug]);

  const mode = useLiveUpdates(slug, liveWindow, () => void refresh(), {
    'music.changed': () => void refresh(),
    resync: () => void refresh(),
  });

  useEffect(
    () => () => {
      requestId.current += 1;
      abortRef.current?.abort();
    },
    [slug],
  );

  return { data, refresh, mode, sessionLost, moduleOff };
}
