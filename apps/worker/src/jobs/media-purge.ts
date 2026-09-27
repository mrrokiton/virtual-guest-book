import type { MediaPurgeJob } from '@vgb/core';
import { weddingScope } from '@vgb/db';
import type { Context } from '../context';

/**
 * Hard delete of a soft-deleted (or failed) item's bytes in storage and Stream. The row stays as
 * a tombstone so counts, moderation history and the audit log keep making sense.
 */
export async function purgeMedia(ctx: Context, job: MediaPurgeJob): Promise<void> {
  const scope = weddingScope(ctx.db, job.weddingId);
  const media = await scope.media.get(job.mediaId);
  if (!media || media.purgedAt || (media.status !== 'deleted' && media.status !== 'failed')) return;

  const keys = [media.originalKey, ...Object.values(media.variants)].filter((k): k is string =>
    Boolean(k),
  );
  await Promise.all(keys.map((k) => ctx.storage.delete(k)));
  if (media.kind === 'video' && media.videoUid) await ctx.video.delete(media);

  await scope.media.update(media.id, { purgedAt: ctx.now(), originalKey: null, variants: {} });
}
