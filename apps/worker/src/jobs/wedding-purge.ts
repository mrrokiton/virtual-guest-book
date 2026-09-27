import { weddingStoragePrefix, type WeddingPurgeJob } from '@vgb/core';
import { applyWeddingTransition, deleteWeddingRow, getWeddingById, weddingScope } from '@vgb/db';
import type { Context } from '../context';

/**
 * Irreversible end of a wedding: every file in storage and Stream, then the rows (media, guest
 * sessions, members, exports cascade). Only an id-level audit entry survives.
 */
export async function purgeWedding(ctx: Context, job: WeddingPurgeJob): Promise<void> {
  const w = await getWeddingById(ctx.db, job.weddingId);
  if (!w) return;
  if (w.status === 'pending_deletion') {
    if (!w.purgeAt || w.purgeAt > ctx.now()) return;
    // Claim first: once the status is `deleted`, a restore can no longer race the file deletion.
    if (!(await applyWeddingTransition(ctx.db, w.id, 'pending_deletion', { to: 'deleted' })))
      return;
  } else if (w.status !== 'deleted') {
    return;
  }

  const scope = weddingScope(ctx.db, w.id);
  const items = await scope.media.listUnpurged();
  for (const m of items) {
    if (m.kind === 'video' && m.videoUid) await ctx.video.delete(m);
  }
  const files = await ctx.storage.deletePrefix(weddingStoragePrefix(w.id));

  await scope.audit({
    actorType: 'system',
    action: 'wedding.purged',
    targetType: 'wedding',
    targetId: w.id,
    metadata: { media: items.length, files },
  });
  await deleteWeddingRow(ctx.db, w.id);
}
