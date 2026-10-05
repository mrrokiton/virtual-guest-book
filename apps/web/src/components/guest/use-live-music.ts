'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MusicPanelData } from '@/lib/music';
import type { LiveMode } from './use-live-gallery';

const POLL_MS = 10_000;
const SSE_RETRY_MS = 60_000;
const SSE_MAX_FAILURES = 3;

export function useLiveMusic(slug: string, initial: MusicPanelData) {
  const [data, setData] = useState(initial);
  const [mode, setMode] = useState<LiveMode>('connecting');
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

  useEffect(() => {
    let source: EventSource | null = null;
    let failures = 0;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };

    const retire = (current: EventSource) => {
      current.onerror = null;
      current.close();
      if (source === current) source = null;
    };

    const startPolling = () => {
      setMode('polling');
      if (!pollTimer) pollTimer = setInterval(() => void refresh(), POLL_MS);
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, SSE_RETRY_MS);
    };

    function connect() {
      if (disposed) return;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (source) retire(source);
      const next = new EventSource(`/api/w/${slug}/events`);
      source = next;
      next.onopen = () => {
        const wasDegraded = failures > 0 || pollTimer !== null;
        failures = 0;
        stopPolling();
        setMode('live');
        if (wasDegraded) void refresh();
      };
      next.onerror = () => {
        if (source !== next) return;
        failures += 1;
        if (failures >= SSE_MAX_FAILURES) {
          retire(next);
          startPolling();
        }
      };
      next.addEventListener('music.changed', () => void refresh());
      next.addEventListener('resync', () => void refresh());
    }

    connect();

    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      disposed = true;
      requestId.current += 1;
      abortRef.current?.abort();
      if (source) retire(source);
      stopPolling();
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [slug, refresh]);

  return { data, refresh, mode, sessionLost, moduleOff };
}
