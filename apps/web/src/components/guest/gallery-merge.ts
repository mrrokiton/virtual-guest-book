import type { GalleryItem } from '@/lib/weddings';

type Sortable = Pick<GalleryItem, 'id' | 'createdAt'>;

/** Same order as the server's keyset pagination: newest first, id as tie-breaker. */
export function byNewest(a: Sortable, b: Sortable): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

export function mergeItems<T extends Sortable>(existing: T[], incoming: T[]): T[] {
  const map = new Map(existing.map((i) => [i.id, i]));
  for (const i of incoming) map.set(i.id, i);
  return [...map.values()].sort(byNewest);
}

/**
 * Applies a fresh first page. It is authoritative for its own time range, so items in that range
 * that are missing from it (hidden or deleted while we were offline) are dropped; older, already
 * loaded pages are kept.
 */
export function applyNewestPage<T extends Sortable>(existing: T[], page: T[]): T[] {
  const oldest = page.at(-1);
  const fresh = new Set(page.map((i) => i.id));
  const kept = existing.filter(
    (i) => fresh.has(i.id) || (oldest !== undefined && byNewest(i, oldest) > 0),
  );
  return mergeItems(kept, page);
}
