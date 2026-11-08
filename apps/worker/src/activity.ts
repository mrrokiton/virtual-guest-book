import { isFullyActive, nextIdleCheckAt, WORKER_IDLE_TICK_MS } from '@vgb/core';
import type { UploadWindow } from '@vgb/db';

/** While awake, how often the worker re-evaluates whether it may sleep. */
export const AWAKE_CHECK_MS = 60_000;
/** While awake, how often lifecycle-tick and pg-boss maintenance run. */
export const MAINTENANCE_MS = 10 * 60_000;
/** While asleep in-process, the longest gap before the worker wakes itself. */
export const SLEEP_TICK_MS = WORKER_IDLE_TICK_MS;
/** A wake request from web keeps the worker awake at least this long. */
export const WAKE_HOLD_MS = 15 * 60_000;
/**
 * After the queues are drained, wait this long before exiting. A job or a wake can arrive in that
 * gap, and exiting first would leave it until the next time web starts the machine.
 */
export const IDLE_EXIT_GRACE_MS = 3_000;

export interface ModeInput {
  now: Date;
  weddings: UploadWindow[];
  /** Jobs that are runnable now or running, across all queues. Deferred jobs do not count. */
  pendingJobs: number;
  wakeUntil: Date | null;
}

export type ModeDecision =
  | { mode: 'awake'; reason: 'wedding' | 'jobs' | 'wake'; nextCheckAt: Date }
  | { mode: 'asleep'; nextCheckAt: Date };

export function decideMode({ now, weddings, pendingJobs, wakeUntil }: ModeInput): ModeDecision {
  const nextAwakeCheck = new Date(now.getTime() + AWAKE_CHECK_MS);
  if (weddings.some((w) => isFullyActive(w, now))) {
    return { mode: 'awake', reason: 'wedding', nextCheckAt: nextAwakeCheck };
  }
  if (pendingJobs > 0) return { mode: 'awake', reason: 'jobs', nextCheckAt: nextAwakeCheck };
  if (wakeUntil && now < wakeUntil) {
    return { mode: 'awake', reason: 'wake', nextCheckAt: nextAwakeCheck };
  }

  return { mode: 'asleep', nextCheckAt: nextIdleCheckAt(now, weddings) };
}
