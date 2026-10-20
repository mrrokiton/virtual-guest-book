'use client';

import { useEffect, useRef, useState } from 'react';
import {
  IDLE_REFRESH_MS,
  LIVE_POLL_MS,
  livePhase,
  timerDelay,
  type LiveWindow,
} from './live-schedule';

const SSE_RETRY_MS = 60_000;
/** Consecutive EventSource failures before switching to polling (some venue proxies kill SSE). */
const SSE_MAX_FAILURES = 3;

/** `idle`: outside the wedding window, refreshed rarely without SSE. */
export type LiveMode = 'connecting' | 'live' | 'polling' | 'idle';

/**
 * Keeps a guest view current. Inside the wedding window it listens on SSE (polling every 30 s if
 * SSE is blocked); outside it refreshes every 10 minutes. A hidden tab makes no requests at all
 * and catches up when it becomes visible again.
 */
export function useLiveUpdates(
  slug: string,
  liveWindow: LiveWindow,
  refresh: () => void,
  events: Record<string, (data: string) => void>,
): LiveMode {
  const [mode, setMode] = useState<LiveMode>('connecting');
  const refreshRef = useRef(refresh);
  const eventsRef = useRef(events);
  useEffect(() => {
    refreshRef.current = refresh;
    eventsRef.current = events;
  });

  const from = liveWindow?.from ?? null;
  const until = liveWindow?.until ?? null;

  useEffect(() => {
    const win = from && until ? { from, until } : null;
    let source: EventSource | null = null;
    let failures = 0;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let phaseTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const catchUp = () => refreshRef.current();

    const retire = (current: EventSource) => {
      current.onerror = null;
      current.close();
      if (source === current) source = null;
    };

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };

    const stopAll = () => {
      if (source) retire(source);
      stopPolling();
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    };

    const startPolling = (ms: number) => {
      if (!pollTimer) pollTimer = setInterval(catchUp, ms);
    };

    function connect() {
      if (disposed) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (source) retire(source);
      const next = new EventSource(`/api/w/${slug}/events`);
      source = next;
      next.onopen = () => {
        const wasDegraded = failures > 0 || pollTimer !== null;
        failures = 0;
        stopPolling();
        setMode('live');
        if (wasDegraded) catchUp();
      };
      next.onerror = () => {
        if (source !== next) return;
        failures += 1;
        if (failures >= SSE_MAX_FAILURES) {
          retire(next);
          setMode('polling');
          startPolling(LIVE_POLL_MS);
          retryTimer = setTimeout(connect, SSE_RETRY_MS);
        }
      };
      for (const name of Object.keys(eventsRef.current)) {
        next.addEventListener(name, (e) =>
          eventsRef.current[name]?.((e as MessageEvent<string>).data),
        );
      }
    }

    function apply(withCatchUp: boolean) {
      if (disposed) return;
      stopAll();
      if (phaseTimer) clearTimeout(phaseTimer);
      phaseTimer = null;
      const now = Date.now();
      const { phase, changesAt } = livePhase(win, now);
      if (changesAt !== null) {
        phaseTimer = setTimeout(() => apply(true), timerDelay(changesAt, now));
      }
      if (document.visibilityState !== 'visible') return;
      if (phase === 'live') {
        failures = 0;
        setMode('connecting');
        connect();
      } else {
        setMode('idle');
        startPolling(IDLE_REFRESH_MS);
      }
      if (withCatchUp) catchUp();
    }

    apply(false);

    // Phones suspend background tabs; catch up as soon as the guest comes back.
    const onVisibility = () => (document.visibilityState === 'visible' ? apply(true) : stopAll());
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      stopAll();
      if (phaseTimer) clearTimeout(phaseTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [slug, from, until]);

  return mode;
}
