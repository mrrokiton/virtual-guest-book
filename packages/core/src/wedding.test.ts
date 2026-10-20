import { describe, expect, it } from 'vitest';
import { warsawMidnight } from './dates';
import { DomainError } from './errors';
import {
  activate,
  addDays,
  computeSchedule,
  DELETION_GRACE_DAYS,
  dueTransition,
  fullActivityWindow,
  guestCanUpload,
  guestCanView,
  isFullyActive,
  requestDeletion,
  restore,
  type WeddingLifecycle,
} from './wedding';
import { PLANS } from './plans';

const event = new Date('2026-06-20T14:00:00Z');

function wedding(overrides: Partial<WeddingLifecycle> = {}): WeddingLifecycle {
  const schedule = computeSchedule(event, 3, 'standard');
  return {
    status: 'active',
    statusBeforeDeletion: null,
    plan: 'standard',
    blockedAt: null,
    approvedAt: event,
    purgeAt: null,
    ...schedule,
    ...overrides,
  };
}

describe('computeSchedule', () => {
  it('closes uploads at the Polish midnight after the last upload day', () => {
    const s = computeSchedule(event, 3, 'standard');
    // Wedding on 20 June, three more days, closes when 24 June starts (CEST).
    expect(s.readOnlyAt).toEqual(new Date('2026-06-23T22:00:00Z'));
    expect(s.archiveAt).toEqual(addDays(s.readOnlyAt, PLANS.standard.galleryDays));
  });

  it('allows uploads on the wedding day only when uploadDays is 0', () => {
    expect(computeSchedule(event, 0, 'standard').readOnlyAt).toEqual(
      new Date('2026-06-20T22:00:00Z'),
    );
  });

  it('counts calendar days across the autumn DST change', () => {
    const autumn = warsawMidnight('2026-10-24')!;
    expect(computeSchedule(autumn, 3, 'standard').readOnlyAt).toEqual(
      new Date('2026-10-27T23:00:00Z'),
    );
  });

  it('counts calendar days across the spring DST change', () => {
    const spring = warsawMidnight('2026-03-28')!;
    expect(computeSchedule(spring, 3, 'standard').readOnlyAt).toEqual(
      new Date('2026-03-31T22:00:00Z'),
    );
  });

  it('rejects an upload window outside 0..3 days', () => {
    expect(() => computeSchedule(event, -1, 'standard')).toThrow(DomainError);
    expect(() => computeSchedule(event, 4, 'standard')).toThrow(DomainError);
    expect(() => computeSchedule(event, 1.5, 'standard')).toThrow(DomainError);
  });
});

describe('fullActivityWindow', () => {
  const day = warsawMidnight('2026-06-20')!;

  it('spans the day before the wedding through the last upload day', () => {
    const w = { eventDate: day, ...computeSchedule(day, 3, 'standard') };
    expect(fullActivityWindow(w)).toEqual({
      from: new Date('2026-06-18T22:00:00Z'),
      until: new Date('2026-06-23T22:00:00Z'),
    });
  });

  it('ends earlier when the upload period is shorter', () => {
    const w = { eventDate: day, ...computeSchedule(day, 1, 'standard') };
    expect(fullActivityWindow(w).until).toEqual(new Date('2026-06-21T22:00:00Z'));
  });

  it('caps a legacy upload period at three days after the wedding', () => {
    const w = { eventDate: day, readOnlyAt: addDays(day, 7) };
    expect(fullActivityWindow(w).until).toEqual(new Date('2026-06-23T22:00:00Z'));
  });

  it('lasts five calendar days across the autumn DST change', () => {
    const autumn = warsawMidnight('2026-10-24')!;
    const w = { eventDate: autumn, ...computeSchedule(autumn, 3, 'standard') };
    expect(fullActivityWindow(w)).toEqual({
      from: new Date('2026-10-22T22:00:00Z'),
      until: new Date('2026-10-27T23:00:00Z'),
    });
  });

  it('starts at the Polish midnight across the spring DST change', () => {
    const spring = warsawMidnight('2026-03-28')!;
    const w = { eventDate: spring, ...computeSchedule(spring, 3, 'standard') };
    expect(fullActivityWindow(w).from).toEqual(new Date('2026-03-26T23:00:00Z'));
  });
});

describe('isFullyActive', () => {
  const day = warsawMidnight('2026-06-20')!;
  const base = {
    status: 'active' as const,
    blockedAt: null,
    eventDate: day,
    ...computeSchedule(day, 3, 'standard'),
  };
  const { from, until } = fullActivityWindow(base);

  it('is exact at both boundaries', () => {
    expect(isFullyActive(base, new Date(from.getTime() - 1))).toBe(false);
    expect(isFullyActive(base, from)).toBe(true);
    expect(isFullyActive(base, new Date(until.getTime() - 1))).toBe(true);
    expect(isFullyActive(base, until)).toBe(false);
  });

  it('stays idle for a wedding activated long in advance', () => {
    expect(isFullyActive(base, addDays(day, -30))).toBe(false);
  });

  it('ignores drafts, blocked and closed weddings', () => {
    expect(isFullyActive({ ...base, status: 'draft' }, day)).toBe(false);
    expect(isFullyActive({ ...base, status: 'read_only' }, day)).toBe(false);
    expect(isFullyActive({ ...base, blockedAt: day }, day)).toBe(false);
  });

  it('follows a moved wedding date', () => {
    const moved = warsawMidnight('2026-07-04')!;
    const w = { ...base, eventDate: moved, ...computeSchedule(moved, 3, 'standard') };
    expect(isFullyActive(w, day)).toBe(false);
    expect(isFullyActive(w, moved)).toBe(true);
  });
});

describe('dueTransition walks the full lifecycle', () => {
  it('active -> read_only -> archived -> pending_deletion -> deleted', () => {
    let w = wedding();
    expect(dueTransition(w, addDays(event, 1))).toBeNull();

    const t1 = dueTransition(w, w.readOnlyAt);
    expect(t1?.to).toBe('read_only');
    w = { ...w, status: 'read_only' };

    expect(dueTransition(w, addDays(w.archiveAt, -1))).toBeNull();
    expect(dueTransition(w, w.archiveAt)?.to).toBe('archived');
    w = { ...w, status: 'archived' };

    const archiveEnd = addDays(w.archiveAt, PLANS.standard.archiveDays);
    expect(dueTransition(w, addDays(archiveEnd, -1))).toBeNull();
    const t3 = dueTransition(w, archiveEnd);
    expect(t3?.to).toBe('pending_deletion');
    expect(t3?.purgeAt).toEqual(addDays(archiveEnd, DELETION_GRACE_DAYS));
    w = { ...w, status: 'pending_deletion', purgeAt: t3!.purgeAt! };

    expect(dueTransition(w, addDays(w.purgeAt!, -1))).toBeNull();
    expect(dueTransition(w, w.purgeAt!)?.to).toBe('deleted');
  });

  it('never moves a draft automatically', () => {
    expect(dueTransition(wedding({ status: 'draft' }), addDays(event, 400))).toBeNull();
  });
});

describe('guest capabilities', () => {
  it('allows upload only while active and before read-only', () => {
    const w = wedding();
    expect(guestCanUpload(w, event)).toBe(true);
    expect(guestCanUpload(w, addDays(event, 8))).toBe(false);
    expect(guestCanUpload({ ...w, status: 'read_only' }, event)).toBe(false);
  });

  it('blocks everything for blocked weddings', () => {
    const w = wedding({ blockedAt: new Date() });
    expect(guestCanView(w)).toBe(false);
    expect(guestCanUpload(w, event)).toBe(false);
  });

  it('hides archived and draft galleries from guests', () => {
    expect(guestCanView(wedding({ status: 'archived' }))).toBe(false);
    expect(guestCanView(wedding({ status: 'draft' }))).toBe(false);
    expect(guestCanView(wedding({ status: 'read_only' }))).toBe(true);
  });
});

describe('manual transitions', () => {
  it('activates a draft only before the upload window closes', () => {
    expect(activate(wedding({ status: 'draft' }), event).to).toBe('active');
    expect(() => activate(wedding({ status: 'draft' }), addDays(event, 10))).toThrow(DomainError);
    expect(() => activate(wedding(), event)).toThrow(DomainError);
  });

  it('refuses to activate a draft that the platform admin has not approved', () => {
    expect(() => activate(wedding({ status: 'draft', approvedAt: null }), event)).toThrow(
      DomainError,
    );
  });

  it('schedules deletion with a grace period and restores to the time-appropriate status', () => {
    const now = addDays(event, 2);
    const t = requestDeletion(wedding(), now);
    expect(t.to).toBe('pending_deletion');
    expect(t.purgeAt).toEqual(addDays(now, DELETION_GRACE_DAYS));

    const pending = wedding({
      status: 'pending_deletion',
      statusBeforeDeletion: 'active',
      purgeAt: t.purgeAt!,
    });
    expect(restore(pending, now).to).toBe('active');
    expect(restore(pending, addDays(event, 20)).to).toBe('read_only');
    expect(restore({ ...pending, statusBeforeDeletion: 'draft' }, now).to).toBe('draft');
  });

  it('keeps a restored wedding for the grace period once its archive ran out', () => {
    const w = wedding({ status: 'pending_deletion', statusBeforeDeletion: 'archived' });
    const archiveDays = PLANS.standard.archiveDays;
    const inArchive = addDays(w.archiveAt, archiveDays - 1);
    expect(restore(w, inArchive)).not.toHaveProperty('archiveAt');

    const late = addDays(w.archiveAt, archiveDays + 5);
    const restored = { ...w, ...restore(w, late), status: 'archived' as const };
    expect(dueTransition(restored, addDays(late, 13))).toBeNull();
    expect(dueTransition(restored, addDays(late, 14))?.to).toBe('pending_deletion');
  });

  it('keeps re-issuing the purge for a wedding stuck in deleted', () => {
    expect(dueTransition(wedding({ status: 'deleted' }), event)?.event.type).toBe('purge_due');
  });

  it('refuses to delete twice', () => {
    expect(() => requestDeletion(wedding({ status: 'pending_deletion' }), event)).toThrow(
      DomainError,
    );
  });
});
