import { and, inArray, isNull, lt } from 'drizzle-orm';
import type { Database } from './client';
import { media } from './schema';

/**
 * Cross-wedding queries for the worker's periodic sweeps. They return only ids; all follow-up
 * work goes through `weddingScope`.
 */

/** Uploads the browser started but never completed (tab closed, network gone). */
export function listStaleUploads(db: Database, olderThan: Date, limit = 500) {
  return db
    .select({ id: media.id, weddingId: media.weddingId })
    .from(media)
    .where(and(inArray(media.status, ['uploading', 'processing']), lt(media.createdAt, olderThan)))
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
