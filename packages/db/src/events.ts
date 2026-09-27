import { sql } from 'drizzle-orm';
import type { Database } from './client';

export const MEDIA_CHANNEL = 'vgb_media';

export type MediaEvent =
  | { type: 'media.ready'; weddingId: string; mediaId: string }
  | { type: 'media.removed'; weddingId: string; mediaId: string };

/** Cross-process fan-out: the worker and every web instance see this via LISTEN. */
export async function publishMediaEvent(db: Database, event: MediaEvent): Promise<void> {
  await db.execute(sql`select pg_notify(${MEDIA_CHANNEL}, ${JSON.stringify(event)})`);
}

export function parseMediaEvent(payload: string | undefined): MediaEvent | null {
  if (!payload) return null;
  try {
    const e = JSON.parse(payload) as MediaEvent;
    return (e.type === 'media.ready' || e.type === 'media.removed') && e.weddingId && e.mediaId
      ? e
      : null;
  } catch {
    return null;
  }
}
