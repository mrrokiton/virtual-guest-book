import { describe, expect, it } from 'vitest';
import { parseMediaEvent } from './events';

describe('parseMediaEvent', () => {
  it('accepts a music change signal without a row id', () => {
    expect(parseMediaEvent(JSON.stringify({ type: 'music.changed', weddingId: 'w1' }))).toEqual({
      type: 'music.changed',
      weddingId: 'w1',
    });
  });

  it('drops extra fields from a music signal', () => {
    expect(
      parseMediaEvent(JSON.stringify({ type: 'music.changed', weddingId: 'w1', mediaId: 'nope' })),
    ).toEqual({ type: 'music.changed', weddingId: 'w1' });
  });

  it('still accepts gallery events', () => {
    expect(
      parseMediaEvent(JSON.stringify({ type: 'media.removed', weddingId: 'w1', mediaId: 'm1' })),
    ).toEqual({ type: 'media.removed', weddingId: 'w1', mediaId: 'm1' });
  });

  it('rejects a signal with no wedding and junk payloads', () => {
    expect(parseMediaEvent(JSON.stringify({ type: 'music.changed' }))).toBeNull();
    expect(parseMediaEvent('nope')).toBeNull();
    expect(parseMediaEvent(undefined)).toBeNull();
  });
});
