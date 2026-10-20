import { describe, expect, it } from 'vitest';
import { livePhase, timerDelay } from './live-schedule';

const win = { from: '2026-06-18T22:00:00.000Z', until: '2026-06-23T22:00:00.000Z' };
const t = (iso: string) => Date.parse(iso);

describe('livePhase', () => {
  it('is idle before the window and switches when it opens', () => {
    expect(livePhase(win, t('2026-06-01T12:00:00Z'))).toEqual({
      phase: 'idle',
      changesAt: t(win.from),
    });
  });

  it('is live inside the window, exact at both edges', () => {
    expect(livePhase(win, t(win.from))).toEqual({
      phase: 'live',
      changesAt: t(win.until),
    });
    expect(livePhase(win, t(win.until) - 1).phase).toBe('live');
    expect(livePhase(win, t(win.until))).toEqual({ phase: 'idle', changesAt: null });
  });

  it('is idle for a gallery with no window', () => {
    expect(livePhase(null, t('2026-06-20T12:00:00Z'))).toEqual({ phase: 'idle', changesAt: null });
  });
});

describe('timerDelay', () => {
  it('never goes negative and stays within the browser timer limit', () => {
    expect(timerDelay(100, 200)).toBe(0);
    expect(timerDelay(1_000, 400)).toBe(600);
    expect(timerDelay(60 * 24 * 3600_000, 0)).toBe(2 ** 31 - 1);
  });
});
