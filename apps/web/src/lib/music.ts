import {
  guestCanUpload,
  MUSIC_MODULE_KEY,
  MUSIC_SAFETY_CAP,
  musicCreateCap,
  type MusicStatus,
} from '@vgb/core';
import { weddingScope, type MusicSuggestion, type Wedding } from '@vgb/db';
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

export interface MusicPanelData {
  isDj: boolean;
  canMutate: boolean;
  capRemaining: number;
  atSafetyCap: boolean;
  open: MusicEntry[];
  history: MusicEntry[];
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

export async function loadMusicPanel(
  wedding: Wedding,
  sessionId: string,
  role: string,
): Promise<MusicPanelData | null> {
  const music = await loadMusicModule(wedding.id);
  if (!music) return null;
  const capInput = await music.scope.music.durableCapInput(sessionId);
  const [open, history] = await Promise.all([
    music.scope.music.listOpen(),
    music.scope.music.listHistory(),
  ]);
  return {
    isDj: role === 'dj',
    canMutate: guestCanUpload(wedding, new Date()),
    capRemaining: Math.max(0, musicCreateCap(capInput) - capInput.mine),
    atSafetyCap: capInput.mine >= MUSIC_SAFETY_CAP,
    open: open.map((row) => toMusicEntry(row, sessionId)),
    history: history.map((row) => toMusicEntry(row, sessionId)),
  };
}
