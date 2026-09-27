'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GalleryItem } from '@/lib/weddings';
import { applyNewestPage, mergeItems } from './gallery-merge';

const POLL_MS = 10_000;
const SSE_RETRY_MS = 60_000;
/** Consecutive EventSource failures before switching to polling (some venue proxies kill SSE). */
const SSE_MAX_FAILURES = 3;

interface Page {
  items: GalleryItem[];
  nextCursor: string | null;
}

export type LiveMode = 'connecting' | 'live' | 'polling';

export function useLiveGallery(
  slug: string,
  initialItems: GalleryItem[],
  initialCursor: string | null,
) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mode, setMode] = useState<LiveMode>('connecting');
  const [sessionLost, setSessionLost] = useState(false);
  const removed = useRef(new Set<string>());

  const fetchPage = useCallback(
    async (after: string | null): Promise<Page | null> => {
      const qs = new URLSearchParams({ limit: '30' });
      if (after) qs.set('cursor', after);
      const res = await fetch(`/api/w/${slug}/media?${qs}`, { cache: 'no-store' }).catch(
        () => null,
      );
      if (res?.status === 401) setSessionLost(true);
      if (!res?.ok) return null;
      return (await res.json()) as Page;
    },
    [slug],
  );

  const refreshNewest = useCallback(async () => {
    const page = await fetchPage(null);
    if (!page) return;
    setItems((prev) => applyNewestPage(prev, page.items));
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const page = await fetchPage(cursor);
    if (page) {
      setItems((prev) =>
        mergeItems(
          prev,
          page.items.filter((i) => !removed.current.has(i.id)),
        ),
      );
      setCursor(page.nextCursor);
    }
    setLoadingMore(false);
  }, [cursor, loadingMore, fetchPage]);

  const removeLocal = useCallback((id: string) => {
    removed.current.add(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

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

    const startPolling = () => {
      setMode('polling');
      if (!pollTimer) pollTimer = setInterval(() => void refreshNewest(), POLL_MS);
      retryTimer = setTimeout(connect, SSE_RETRY_MS);
    };

    function connect() {
      if (disposed) return;
      source = new EventSource(`/api/w/${slug}/events`);
      source.onopen = () => {
        const wasDegraded = failures > 0 || pollTimer !== null;
        failures = 0;
        stopPolling();
        setMode('live');
        if (wasDegraded) void refreshNewest();
      };
      source.onerror = () => {
        failures += 1;
        if (failures >= SSE_MAX_FAILURES) {
          source?.close();
          source = null;
          startPolling();
        }
      };
      source.addEventListener('media.ready', (e) => {
        const { item } = JSON.parse((e as MessageEvent<string>).data) as { item: GalleryItem };
        if (removed.current.has(item.id)) return;
        setItems((prev) => mergeItems(prev, [item]));
      });
      source.addEventListener('media.removed', (e) => {
        const { id } = JSON.parse((e as MessageEvent<string>).data) as { id: string };
        removed.current.add(id);
        setItems((prev) => prev.filter((i) => i.id !== id));
      });
      source.addEventListener('resync', () => void refreshNewest());
    }

    connect();

    // Phones suspend background tabs; catch up as soon as the guest comes back.
    const onVisible = () => document.visibilityState === 'visible' && void refreshNewest();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      disposed = true;
      source?.close();
      stopPolling();
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [slug, refreshNewest]);

  return {
    items,
    hasMore: cursor !== null,
    loadingMore,
    loadMore,
    refreshNewest,
    removeLocal,
    mode,
    sessionLost,
  };
}
