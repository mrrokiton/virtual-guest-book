import { computeSchedule, warsawMidnight } from '@vgb/core';
import type { UploadWindow } from '@vgb/db';
import { describe, expect, it } from 'vitest';
import { AWAKE_CHECK_MS, decideMode, SLEEP_TICK_MS } from './activity';

const day = warsawMidnight('2026-06-20')!;

function wedding(eventDate = day, overrides: Partial<UploadWindow> = {}): UploadWindow {
  return {
    id: 'w1',
    status: 'active',
    blockedAt: null,
    eventDate,
    readOnlyAt: computeSchedule(eventDate, 3, 'standard').readOnlyAt,
    ...overrides,
  };
}

const at = (iso: string) => new Date(iso);

describe('decideMode', () => {
  it('stays awake through the five-day window', () => {
    for (const now of [
      at('2026-06-18T22:00:00Z'), // midnight starting the day before
      at('2026-06-20T18:00:00Z'), // the wedding evening
      at('2026-06-23T21:59:00Z'), // last minute of the third day after
    ]) {
      const d = decideMode({ now, weddings: [wedding()], pendingJobs: 0, wakeUntil: null });
      expect(d).toMatchObject({ mode: 'awake', reason: 'wedding' });
      expect(d.nextCheckAt.getTime() - now.getTime()).toBe(AWAKE_CHECK_MS);
    }
  });

  it('sleeps once the window closed and wakes hourly', () => {
    const now = at('2026-06-23T22:00:00Z');
    const d = decideMode({ now, weddings: [wedding()], pendingJobs: 0, wakeUntil: null });
    expect(d.mode).toBe('asleep');
    expect(d.nextCheckAt.getTime() - now.getTime()).toBe(SLEEP_TICK_MS);
  });

  it('sleeps after a shorter upload period ends', () => {
    const short = wedding(day, { readOnlyAt: computeSchedule(day, 0, 'standard').readOnlyAt });
    const now = at('2026-06-20T22:30:00Z');
    expect(decideMode({ now, weddings: [short], pendingJobs: 0, wakeUntil: null }).mode).toBe(
      'asleep',
    );
  });

  it('wakes exactly when the next window opens', () => {
    const now = at('2026-06-18T21:30:00Z');
    const d = decideMode({ now, weddings: [wedding()], pendingJobs: 0, wakeUntil: null });
    expect(d).toEqual({ mode: 'asleep', nextCheckAt: at('2026-06-18T22:00:00Z') });
  });

  it('does not run at full speed for a wedding activated weeks ahead', () => {
    const now = at('2026-05-20T12:00:00Z');
    const d = decideMode({ now, weddings: [wedding()], pendingJobs: 0, wakeUntil: null });
    expect(d.mode).toBe('asleep');
    expect(d.nextCheckAt.getTime() - now.getTime()).toBe(SLEEP_TICK_MS);
  });

  it('keeps draining while jobs are runnable or running', () => {
    const now = at('2026-08-01T12:00:00Z');
    expect(decideMode({ now, weddings: [], pendingJobs: 2, wakeUntil: null })).toMatchObject({
      mode: 'awake',
      reason: 'jobs',
    });
  });

  it('honours a recent wake request', () => {
    const now = at('2026-08-01T12:00:00Z');
    const wakeUntil = new Date(now.getTime() + 60_000);
    expect(decideMode({ now, weddings: [], pendingJobs: 0, wakeUntil })).toMatchObject({
      mode: 'awake',
      reason: 'wake',
    });
    expect(decideMode({ now: wakeUntil, weddings: [], pendingJobs: 0, wakeUntil }).mode).toBe(
      'asleep',
    );
  });

  it('ignores blocked weddings', () => {
    const now = at('2026-06-20T18:00:00Z');
    const blocked = wedding(day, { blockedAt: now });
    expect(decideMode({ now, weddings: [blocked], pendingJobs: 0, wakeUntil: null }).mode).toBe(
      'asleep',
    );
  });
});
