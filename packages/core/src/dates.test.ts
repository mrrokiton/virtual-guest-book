import { describe, expect, it } from 'vitest';
import { startOfWarsawDay, toWarsawDateInput, warsawMidnight } from './dates';

describe('warsawMidnight', () => {
  it('uses the summer and winter offsets', () => {
    expect(warsawMidnight('2026-06-20')).toEqual(new Date('2026-06-19T22:00:00Z'));
    expect(warsawMidnight('2026-12-20')).toEqual(new Date('2026-12-19T23:00:00Z'));
  });

  it('rejects anything but YYYY-MM-DD', () => {
    expect(warsawMidnight('20.06.2026')).toBeNull();
    expect(warsawMidnight('2026-13-40')).toBeNull();
  });
});

describe('toWarsawDateInput', () => {
  it('reads the calendar day in Poland, not in UTC', () => {
    expect(toWarsawDateInput(new Date('2026-06-19T22:30:00Z'))).toBe('2026-06-20');
    expect(toWarsawDateInput(new Date('2026-06-19T21:59:59Z'))).toBe('2026-06-19');
  });
});

describe('startOfWarsawDay', () => {
  it('returns the midnight of the same day for any time within it', () => {
    expect(startOfWarsawDay(new Date('2026-06-20T21:59:00Z'))).toEqual(
      new Date('2026-06-19T22:00:00Z'),
    );
  });

  it('adds calendar days across DST changes', () => {
    const autumn = warsawMidnight('2026-10-24')!;
    expect(startOfWarsawDay(autumn, 2)).toEqual(new Date('2026-10-25T23:00:00Z'));
    const spring = warsawMidnight('2026-03-28')!;
    expect(startOfWarsawDay(spring, 2)).toEqual(new Date('2026-03-29T22:00:00Z'));
    expect(startOfWarsawDay(spring, -1)).toEqual(new Date('2026-03-26T23:00:00Z'));
  });

  it('crosses month and year boundaries', () => {
    expect(startOfWarsawDay(warsawMidnight('2026-12-31')!, 1)).toEqual(
      new Date('2026-12-31T23:00:00Z'),
    );
  });
});
