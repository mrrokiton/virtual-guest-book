import { sql } from 'drizzle-orm';
import type { Database } from './client';

export const MEDIA_CHANNEL = 'vgb_media';

export type MediaEvent =
  | { type: 'media.ready'; weddingId: string; mediaId: string }
  | { type: 'media.removed'; weddingId: string; mediaId: string }
  | { type: 'music.changed'; weddingId: string };

/** Cross-process fan-out: the worker and every web instance see this via LISTEN. */
export async function publishMediaEvent(db: Database, event: MediaEvent): Promise<void> {
  await db.execute(sql`select pg_notify(${MEDIA_CHANNEL}, ${JSON.stringify(event)})`);
}

/** Ask open music lists to refetch. The payload stays small because each session sees its own rows. */
export async function publishMusicChanged(db: Database, weddingId: string): Promise<void> {
  await publishMediaEvent(db, { type: 'music.changed', weddingId });
}

export function parseMediaEvent(payload: string | undefined): MediaEvent | null {
  if (!payload) return null;
  try {
    const e = JSON.parse(payload) as { type?: string; weddingId?: string; mediaId?: string };
    if (typeof e.weddingId !== 'string' || !e.weddingId) return null;
    if (e.type === 'music.changed') return { type: 'music.changed', weddingId: e.weddingId };
    if ((e.type === 'media.ready' || e.type === 'media.removed') && e.mediaId) {
      return { type: e.type, weddingId: e.weddingId, mediaId: e.mediaId };
    }
    return null;
  } catch {
    return null;
  }
}
