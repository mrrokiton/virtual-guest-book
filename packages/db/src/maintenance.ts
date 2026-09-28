import { and, asc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { Database } from './client';
import { media } from './schema';

/**
 * Cross-wedding queries for the worker's periodic sweeps. All follow-up writes go through
 * `weddingScope`.
 */

/** Uploads the browser started but never completed (tab closed, network gone). */
export function listStaleUploads(db: Database, olderThan: Date, limit = 500) {
  return db
    .select()
    .from(media)
    .where(and(eq(media.status, 'uploading'), lt(media.createdAt, olderThan)))
    .limit(limit);
}

/**
 * Files that reached storage or Stream but never finished processing: a photo job that ran out
 * of retries, a lost enqueue, a Stream webhook that never came. Oldest first, so a large backlog
 * cannot starve the items that are closest to giving up.
 */
export function listStuckProcessing(db: Database, olderThan: Date, limit = 200) {
  return db
    .select()
    .from(media)
    .where(and(eq(media.status, 'processing'), lt(media.createdAt, olderThan)))
    .orderBy(asc(media.createdAt))
    .limit(limit);
}

/** Safety net for purge jobs that were lost or exhausted their retries. */
export function listPurgeBacklog(db: Database, olderThan: Date, limit = 500) {
  return db
    .select({ id: media.id, weddingId: media.weddingId })
    .from(media)
    .where(
      and(
        inArray(media.status, ['deleted', 'failed']),
        isNull(media.purgedAt),
        lt(media.createdAt, olderThan),
      ),
    )
    .limit(limit);
}
