export const UPLOAD_NOTICE_DISMISS_MS = 4000;

export type UploadNoticeStatus = 'queued' | 'working' | 'done' | 'error';

export type UploadNoticeTask = { key: string; status: UploadNoticeStatus };

export type UploadNoticePhase = 'hidden' | 'working' | 'success' | 'error';

export function uploadNoticePhase(
  tasks: readonly { status: UploadNoticeStatus }[],
): UploadNoticePhase {
  if (tasks.length === 0) return 'hidden';
  if (tasks.some((task) => task.status === 'queued' || task.status === 'working')) return 'working';
  if (tasks.some((task) => task.status === 'error')) return 'error';
  return 'success';
}

/** True only when the visible rows are still exactly the successful batch that started the timer. */
export function isSameSuccessBatch(
  current: readonly UploadNoticeTask[],
  keys: readonly string[],
): boolean {
  if (uploadNoticePhase(current) !== 'success') return false;
  if (current.length !== keys.length) return false;
  const expected = new Set(keys);
  return current.every((task) => expected.has(task.key));
}
