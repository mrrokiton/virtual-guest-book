'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GalleryItem } from '@/lib/weddings';
import { applyNewestPage, mergeItems } from './gallery-merge';
import { OWN_UPLOAD_REFRESH_MS, type LiveWindow } from './live-schedule';
import { useLiveUpdates } from './use-live-updates';

interface Page {
  items: GalleryItem[];
  nextCursor: string | null;
}

export function useLiveGallery(
  slug: string,
  liveWindow: LiveWindow,
  initialItems: GalleryItem[],
  initialCursor: string | null,
) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
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

  const mode = useLiveUpdates(slug, liveWindow, () => void refreshNewest(), {
    'media.ready': (data) => {
      const { item } = JSON.parse(data) as { item: GalleryItem };
      if (removed.current.has(item.id)) return;
      setItems((prev) => mergeItems(prev, [item]));
    },
    'media.removed': (data) => {
      const { id } = JSON.parse(data) as { id: string };
      removed.current.add(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    },
    resync: () => void refreshNewest(),
  });

  const modeRef = useRef(mode);
  const ownUploadTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    const timers = ownUploadTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  /** Live mode gets the item over SSE; otherwise poll a few times while it is processed. */
  const expectOwnUpload = useCallback(() => {
    if (modeRef.current === 'live') return;
    for (const ms of OWN_UPLOAD_REFRESH_MS) {
      const timer = setTimeout(() => {
        ownUploadTimers.current.delete(timer);
        void refreshNewest();
      }, ms);
      ownUploadTimers.current.add(timer);
    }
  }, [refreshNewest]);

  return {
    items,
    hasMore: cursor !== null,
    loadingMore,
    loadMore,
    refreshNewest,
    expectOwnUpload,
    removeLocal,
    mode,
    sessionLost,
  };
}
