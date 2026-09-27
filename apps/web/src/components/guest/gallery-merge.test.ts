import { describe, expect, it } from 'vitest';
import { applyNewestPage, mergeItems } from './gallery-merge';

const item = (id: string, minute: number) => ({
  id,
  createdAt: `2026-07-04T18:${String(minute).padStart(2, '0')}:00.000Z`,
});

describe('mergeItems', () => {
  it('dedupes live events and keeps newest-first order', () => {
    const merged = mergeItems([item('b', 10), item('a', 5)], [item('c', 20), item('b', 10)]);
    expect(merged.map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });

  it('breaks timestamp ties by id like the server cursor', () => {
    expect(mergeItems([item('a', 1)], [item('b', 1)]).map((i) => i.id)).toEqual(['b', 'a']);
  });
});

describe('applyNewestPage', () => {
  it('drops items removed within the refreshed range but keeps older pages', () => {
    const existing = [item('e', 50), item('d', 40), item('c', 30), item('b', 20), item('a', 10)];
    // "d" was hidden by a moderator while the phone was asleep; "f" is new.
    const page = [item('f', 55), item('e', 50), item('c', 30)];
    expect(applyNewestPage(existing, page).map((i) => i.id)).toEqual(['f', 'e', 'c', 'b', 'a']);
  });

  it('empties the gallery when the server says there is nothing left', () => {
    expect(applyNewestPage([item('a', 1)], [])).toEqual([]);
  });
});
