import { DomainError } from './errors';
import { planLimits, type PlanId } from './plans';

export const WEDDING_STATUSES = [
  'draft',
  'active',
  'read_only',
  'archived',
  'pending_deletion',
  'deleted',
] as const;
export type WeddingStatus = (typeof WEDDING_STATUSES)[number];

export const DELETION_GRACE_DAYS = 14;
export const DEFAULT_UPLOAD_DAYS = 7;
export const MAX_UPLOAD_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export interface WeddingLifecycle {
  status: WeddingStatus;
  statusBeforeDeletion: WeddingStatus | null;
  plan: PlanId;
  readOnlyAt: Date;
  archiveAt: Date;
  purgeAt: Date | null;
  blockedAt: Date | null;
  approvedAt: Date | null;
}

export interface WeddingSchedule {
  readOnlyAt: Date;
  archiveAt: Date;
}

/**
 * Uploads stay open until the end of `uploadDays` after the event; the gallery then stays
 * viewable for the plan's `galleryDays` before it is archived.
 */
export function computeSchedule(
  eventDate: Date,
  uploadDays: number,
  plan: PlanId,
): WeddingSchedule {
  if (!Number.isInteger(uploadDays) || uploadDays < 1 || uploadDays > MAX_UPLOAD_DAYS) {
    throw new DomainError(
      'invalid_input',
      `Okno dodawania zdjęć musi mieć od 1 do ${MAX_UPLOAD_DAYS} dni.`,
    );
  }
  const readOnlyAt = addDays(eventDate, uploadDays);
  return { readOnlyAt, archiveAt: addDays(readOnlyAt, planLimits(plan).galleryDays) };
}

export function guestCanView(w: Pick<WeddingLifecycle, 'status' | 'blockedAt'>): boolean {
  return !w.blockedAt && (w.status === 'active' || w.status === 'read_only');
}

export function guestCanUpload(
  w: Pick<WeddingLifecycle, 'status' | 'blockedAt' | 'readOnlyAt'>,
  now: Date,
): boolean {
  return !w.blockedAt && w.status === 'active' && now < w.readOnlyAt;
}

export function adminCanView(w: Pick<WeddingLifecycle, 'status'>): boolean {
  return w.status !== 'deleted';
}

export function adminCanEdit(w: Pick<WeddingLifecycle, 'status'>): boolean {
  return w.status === 'draft' || w.status === 'active' || w.status === 'read_only';
}

export type LifecycleEvent =
  | { type: 'became_read_only' }
  | { type: 'archived' }
  | { type: 'deletion_scheduled'; purgeAt: Date; automatic: boolean }
  | { type: 'purge_due' };

export interface Transition {
  to: WeddingStatus;
  purgeAt?: Date | null;
  statusBeforeDeletion?: WeddingStatus | null;
  archiveAt?: Date;
  event: LifecycleEvent;
}

/**
 * Time-driven transition that is due at `now`, or null. `deleted` is reached by the purge job; a
 * row still in `deleted` means that job failed, so the purge is due again.
 */
export function dueTransition(w: WeddingLifecycle, now: Date): Transition | null {
  switch (w.status) {
    case 'active':
      return now >= w.readOnlyAt ? { to: 'read_only', event: { type: 'became_read_only' } } : null;
    case 'read_only':
      return now >= w.archiveAt ? { to: 'archived', event: { type: 'archived' } } : null;
    case 'archived': {
      const archiveEndsAt = addDays(w.archiveAt, planLimits(w.plan).archiveDays);
      if (now < archiveEndsAt) return null;
      const purgeAt = addDays(now, DELETION_GRACE_DAYS);
      return {
        to: 'pending_deletion',
        purgeAt,
        statusBeforeDeletion: 'archived',
        event: { type: 'deletion_scheduled', purgeAt, automatic: true },
      };
    }
    case 'pending_deletion':
      return w.purgeAt && now >= w.purgeAt ? { to: 'deleted', event: { type: 'purge_due' } } : null;
    case 'deleted':
      return { to: 'deleted', event: { type: 'purge_due' } };
    default:
      return null;
  }
}

export function activate(w: WeddingLifecycle, now: Date): { to: 'active' } {
  if (w.status !== 'draft') {
    throw new DomainError('invalid_state', 'Tylko wesele w stanie szkicu można aktywować.');
  }
  if (!w.approvedAt) {
    throw new DomainError(
      'invalid_state',
      'Wesele czeka na zatwierdzenie przez administratora platformy.',
    );
  }
  if (now >= w.readOnlyAt) {
    throw new DomainError('invalid_state', 'Okno dodawania zdjęć już minęło. Zmień datę wesela.');
  }
  return { to: 'active' };
}

export function requestDeletion(w: WeddingLifecycle, now: Date): Transition {
  if (w.status === 'pending_deletion' || w.status === 'deleted') {
    throw new DomainError('invalid_state', 'Wesele jest już zaplanowane do usunięcia.');
  }
  const purgeAt = addDays(now, DELETION_GRACE_DAYS);
  return {
    to: 'pending_deletion',
    purgeAt,
    statusBeforeDeletion: w.status,
    event: { type: 'deletion_scheduled', purgeAt, automatic: false },
  };
}

/**
 * Undo a scheduled deletion; the status is recomputed from the schedule so time keeps moving. A
 * wedding whose archive period already ran out gets `DELETION_GRACE_DAYS` more, otherwise the next
 * lifecycle tick would schedule the deletion again right away.
 */
export function restore(w: WeddingLifecycle, now: Date): Omit<Transition, 'event'> {
  if (w.status !== 'pending_deletion') {
    throw new DomainError(
      'invalid_state',
      'Tylko wesele zaplanowane do usunięcia można przywrócić.',
    );
  }
  const base = { purgeAt: null, statusBeforeDeletion: null };
  if (w.statusBeforeDeletion === 'draft') return { to: 'draft', ...base };
  if (now < w.readOnlyAt) return { to: 'active', ...base };
  if (now < w.archiveAt) return { to: 'read_only', ...base };
  const archiveDays = planLimits(w.plan).archiveDays;
  return now < addDays(w.archiveAt, archiveDays)
    ? { to: 'archived', ...base }
    : { to: 'archived', archiveAt: addDays(now, DELETION_GRACE_DAYS - archiveDays), ...base };
}
