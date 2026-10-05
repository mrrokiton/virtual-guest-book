import { describe, expect, it } from 'vitest';
import {
  canCreateMusicSuggestion,
  compareMusicQueue,
  disableFairQueue,
  enableFairQueue,
  insertMusicSuggestion,
  musicBodyError,
  musicCreateCap,
  normalizeMusicBody,
  type MusicAuthorLoad,
  type MusicQueueItem,
} from './music';

function cap(mine: number, totalDurable: number, authorCount: number) {
  return musicCreateCap({ mine, totalDurable, authorCount });
}

describe('musicCreateCap', () => {
  it('lets the first guest add three suggestions on an empty list', () => {
    expect(cap(0, 0, 0)).toBe(3);
    expect(canCreateMusicSuggestion({ mine: 0, totalDurable: 0, authorCount: 0 })).toBe(true);
    expect(canCreateMusicSuggestion({ mine: 3, totalDurable: 3, authorCount: 1 })).toBe(true);
    expect(cap(3, 3, 1)).toBe(5);
  });

  it('keeps raising the cap by two while one person is the only author, until 40', () => {
    expect(cap(5, 5, 1)).toBe(7);
    expect(cap(38, 38, 1)).toBe(40);
    expect(canCreateMusicSuggestion({ mine: 39, totalDurable: 39, authorCount: 1 })).toBe(true);
    expect(canCreateMusicSuggestion({ mine: 40, totalDurable: 40, authorCount: 1 })).toBe(false);
  });

  it('gives a new guest room once someone else already has suggestions', () => {
    // A has 10. B has none yet, so B is counted only as the caller.
    expect(cap(0, 10, 1)).toBe(7);
    expect(canCreateMusicSuggestion({ mine: 0, totalDurable: 10, authorCount: 1 })).toBe(true);
    // The same snapshot does not allow a seventh durable suggestion.
    expect(canCreateMusicSuggestion({ mine: 7, totalDurable: 10, authorCount: 2 })).toBe(false);
  });

  it('does not freeze the leader before the second person has a durable suggestion', () => {
    // A is still the only author, so A's own average still grows.
    expect(cap(10, 10, 1)).toBe(12);
    expect(canCreateMusicSuggestion({ mine: 10, totalDurable: 10, authorCount: 1 })).toBe(true);
  });

  it('stops the leader as soon as a second author exists', () => {
    expect(cap(10, 11, 2)).toBe(7);
    expect(canCreateMusicSuggestion({ mine: 10, totalDurable: 11, authorCount: 2 })).toBe(false);
    expect(canCreateMusicSuggestion({ mine: 1, totalDurable: 11, authorCount: 2 })).toBe(true);
  });

  it('lets two equal authors keep going together until the safety cap', () => {
    expect(cap(10, 20, 2)).toBe(12);
    expect(canCreateMusicSuggestion({ mine: 10, totalDurable: 20, authorCount: 2 })).toBe(true);
    expect(canCreateMusicSuggestion({ mine: 40, totalDurable: 80, authorCount: 2 })).toBe(false);
  });

  it('counts a brand new third guest against everyone who already submitted', () => {
    // A=10, B=1, C=0. C is not an author yet.
    expect(cap(0, 11, 2)).toBe(5);
    expect(cap(10, 11, 2)).toBe(7);
    expect(cap(1, 11, 2)).toBe(7);
    expect(canCreateMusicSuggestion({ mine: 10, totalDurable: 11, authorCount: 2 })).toBe(false);
    expect(canCreateMusicSuggestion({ mine: 1, totalDurable: 11, authorCount: 2 })).toBe(true);
  });
});

describe('normalizeMusicBody', () => {
  it('trims, collapses spaces, and folds case', () => {
    expect(normalizeMusicBody('  Dancing   Queen ')).toBe('dancing queen');
    expect(musicBodyError('   ')).toBe('Wpisz propozycję.');
    expect(musicBodyError('a'.repeat(121))).toMatch(/120/);
    expect(musicBodyError('Abba')).toBeNull();
  });
});

function item(
  id: string,
  sessionId: string,
  minute: number,
  queueRank: number | null = null,
): MusicQueueItem {
  return {
    id,
    sessionId,
    createdAt: new Date(Date.UTC(2026, 5, 20, 18, minute)),
    queueRank,
  };
}

function ids(rows: MusicQueueItem[]): string[] {
  return rows.map((row) => row.id);
}

function loads(open: Record<string, number>, done: Record<string, number> = {}): MusicAuthorLoad[] {
  const ids = new Set([...Object.keys(open), ...Object.keys(done)]);
  return [...ids].map((sessionId) => ({
    sessionId,
    openCount: open[sessionId] ?? 0,
    doneCount: done[sessionId] ?? 0,
  }));
}

describe('insertMusicSuggestion', () => {
  it('appends on a short list even when fair queue is on', () => {
    let open: MusicQueueItem[] = [];
    open = insertMusicSuggestion({
      fairQueue: true,
      open,
      insert: item('A1', 'A', 1),
      authors: loads({ A: 1 }),
    });
    open = insertMusicSuggestion({
      fairQueue: true,
      open,
      insert: item('A2', 'A', 2),
      authors: loads({ A: 2 }),
    });
    expect(ids(open)).toEqual(['A1', 'A2']);

    open = insertMusicSuggestion({
      fairQueue: true,
      open,
      insert: item('A3', 'A', 3),
      authors: loads({ A: 3 }),
    });
    open = insertMusicSuggestion({
      fairQueue: true,
      open,
      insert: item('A4', 'A', 4),
      authors: loads({ A: 4 }),
    });
    expect(ids(open)).toEqual(['A1', 'A2', 'A3', 'A4']);
  });

  it('keeps the frozen head and puts a lighter guest ahead in the tail', () => {
    let open = [item('A1', 'A', 1, 1000), item('A2', 'A', 2, 2000), item('A3', 'A', 3, 3000)];
    open = insertMusicSuggestion({
      fairQueue: true,
      open,
      insert: item('A4', 'A', 4),
      authors: loads({ A: 4 }),
    });
    open = insertMusicSuggestion({
      fairQueue: true,
      open,
      insert: item('B1', 'B', 5),
      authors: loads({ A: 4, B: 1 }),
    });
    expect(ids(open)).toEqual(['A1', 'A2', 'A3', 'B1', 'A4']);

    open = insertMusicSuggestion({
      fairQueue: true,
      open,
      insert: item('B2', 'B', 6),
      authors: loads({ A: 4, B: 2 }),
    });
    expect(ids(open)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'A4']);
  });

  it('does not reshuffle when a head item leaves, and restores it on undo', () => {
    const ranked = insertMusicSuggestion({
      fairQueue: true,
      open: [
        item('A1', 'A', 1, 1000),
        item('A2', 'A', 2, 2000),
        item('A3', 'A', 3, 3000),
        item('B1', 'B', 5, 4000),
        item('A4', 'A', 4, 5000),
      ],
      insert: item('B2', 'B', 6),
      authors: loads({ A: 4, B: 2 }),
    });
    const full = ranked;
    expect(ids(ranked)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'A4']);

    const played = full.filter((row) => row.id !== 'A1').sort(compareMusicQueue);
    expect(ids(played)).toEqual(['A2', 'A3', 'B1', 'B2', 'A4']);

    const undone = [...played, full[0]!].sort(compareMusicQueue);
    expect(ids(undone)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'A4']);

    const deleted = undone.filter((row) => row.id !== 'A4').sort(compareMusicQueue);
    expect(ids(deleted)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2']);
  });

  it('orders a disabled fair queue by creation time', () => {
    const open = [item('B1', 'B', 5, 4000), item('A1', 'A', 1, 1000), item('A4', 'A', 4, 9000)];
    expect(ids(disableFairQueue(open))).toEqual(['A1', 'A4', 'B1']);
  });

  it('freezes the current head when fair queue is switched on', () => {
    const open = [
      item('A1', 'A', 1, 1000),
      item('A2', 'A', 2, 2000),
      item('A3', 'A', 3, 3000),
      item('A4', 'A', 4, 4000),
      item('B1', 'B', 5, 5000),
    ];
    const enabled = enableFairQueue(open, loads({ A: 4, B: 1 }));
    expect(ids(enabled)).toEqual(['A1', 'A2', 'A3', 'B1', 'A4']);
    expect(enabled[0]?.queueRank).toBe(1000);
    expect(enabled[3]?.queueRank).toBeGreaterThan(enabled[2]?.queueRank ?? 0);
  });
});
