/** Full-activity window of the wedding as ISO strings, or null when it is not running at all. */
export type LiveWindow = { from: string; until: string } | null;

/** Inside the window, when SSE is blocked (some venue proxies kill it). */
export const LIVE_POLL_MS = 30_000;
/**
 * Outside the window (early activation, read-only gallery): no SSE, refresh this often while the
 * tab is visible. Longer than Neon's 5-minute idle timeout, so a forgotten tab lets it sleep.
 */
export const IDLE_REFRESH_MS = 10 * 60_000;
/** Outside the window a guest's own upload has no push event, so look for it a few times. */
export const OWN_UPLOAD_REFRESH_MS = [10_000, 30_000];

/** Browsers fire a longer setTimeout immediately. */
const MAX_TIMER_MS = 2 ** 31 - 1;

export type LivePhase = 'live' | 'idle';

export function livePhase(
  win: LiveWindow,
  now: number,
): { phase: LivePhase; changesAt: number | null } {
  if (!win) return { phase: 'idle', changesAt: null };
  const from = Date.parse(win.from);
  const until = Date.parse(win.until);
  if (now < from) return { phase: 'idle', changesAt: from };
  if (now < until) return { phase: 'live', changesAt: until };
  return { phase: 'idle', changesAt: null };
}

export function timerDelay(at: number, now: number): number {
  return Math.min(MAX_TIMER_MS, Math.max(0, at - now));
}
