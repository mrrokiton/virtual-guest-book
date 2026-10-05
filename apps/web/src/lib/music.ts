import { MUSIC_MODULE_KEY, type MusicStatus } from '@vgb/core';
import { weddingScope, type MusicSuggestion } from '@vgb/db';
import { db } from './server';

export interface MusicEntry {
  id: string;
  kind: 'track' | 'genre';
  body: string;
  status: MusicStatus;
  authorName: string | null;
  mine: boolean;
  createdAt: string;
}

export function toMusicEntry(row: MusicSuggestion, sessionId: string): MusicEntry {
  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    status: row.status,
    authorName: row.authorName,
    mine: row.guestSessionId === sessionId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function loadMusicModule(weddingId: string) {
  const scope = weddingScope(db(), weddingId);
  const modules = await scope.modules.list();
  const mod = modules.find((item) => item.moduleKey === MUSIC_MODULE_KEY);
  if (!mod?.enabled) return null;
  return { scope, fairQueue: mod.config.fairQueue === true };
}
