import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import {
  activate,
  addDays,
  computeSchedule,
  DELETION_GRACE_DAYS,
  dueTransition,
  guestCanUpload,
  guestCanView,
  requestDeletion,
  restore,
  type WeddingLifecycle,
} from './wedding';
import { PLANS } from './plans';

const event = new Date('2026-06-20T14:00:00Z');

function wedding(overrides: Partial<WeddingLifecycle> = {}): WeddingLifecycle {
  const schedule = computeSchedule(event, 7, 'standard');
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
  it('derives read-only and archive dates from the event and plan', () => {
    const s = computeSchedule(event, 7, 'standard');
    expect(s.readOnlyAt).toEqual(addDays(event, 7));
    expect(s.archiveAt).toEqual(addDays(event, 7 + PLANS.standard.galleryDays));
  });

  it('rejects an upload window outside 1..30 days', () => {
    expect(() => computeSchedule(event, 0, 'standard')).toThrow(DomainError);
    expect(() => computeSchedule(event, 31, 'standard')).toThrow(DomainError);
  });
});

describe('dueTransition walks the full lifecycle', () => {
  it('active -> read_only -> archived -> pending_deletion -> deleted', () => {
    let w = wedding();
    expect(dueTransition(w, addDays(event, 1))).toBeNull();

    const t1 = dueTransition(w, addDays(event, 7));
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

  it('refuses to delete twice', () => {
    expect(() => requestDeletion(wedding({ status: 'pending_deletion' }), event)).toThrow(
      DomainError,
    );
  });
});
