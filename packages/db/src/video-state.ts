import { PENDING_MEDIA_STATUSES } from '@vgb/core';
import type { Database } from './client';
import { publishMediaEvent } from './events';
import { weddingScope, type Media } from './wedding-scope';

/**
 * Stream finished encoding (webhook or the worker's reconcile sweep). Returns false when the video
 * was deleted, hidden or already handled in the meantime, so repeated calls are harmless.
 */
export async function markVideoReady(
  db: Database,
  video: Media,
  info: { durationSeconds?: number | null; width?: number | null; height?: number | null },
  now: Date,
): Promise<boolean> {
  const row = await weddingScope(db, video.weddingId).media.update(
    video.id,
    {
      status: 'ready',
      readyAt: now,
      durationSeconds: info.durationSeconds ?? video.durationSeconds,
      width: info.width ?? null,
      height: info.height ?? null,
    },
    { from: PENDING_MEDIA_STATUSES },
  );
  if (!row) return false;
  await publishMediaEvent(db, {
    type: 'media.ready',
    weddingId: video.weddingId,
    mediaId: video.id,
  });
  return true;
}

/** Marks a pending upload failed; false if it already reached another status. */
export async function markMediaFailed(
  db: Database,
  item: Pick<Media, 'id' | 'weddingId'>,
  failureReason: string,
): Promise<boolean> {
  const row = await weddingScope(db, item.weddingId).media.update(
    item.id,
    { status: 'failed', failureReason },
    { from: PENDING_MEDIA_STATUSES },
  );
  return row !== null;
}
