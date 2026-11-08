export const TOAST_MS = { success: 4000, danger: 8000, neutral: 4000 } as const;

export const TOAST_VIEWPORT_CLASS =
  'pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4';

export type ToastTone = keyof typeof TOAST_MS;

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
  expiresAt: number;
}

export function pushToast(
  items: readonly ToastItem[],
  message: string,
  tone: ToastTone,
  now: number,
  id: string,
): ToastItem[] {
  const live = expireToasts(items, now);
  if (live.some((item) => item.message === message && item.tone === tone)) return live;
  return [...live, { id, message, tone, expiresAt: now + TOAST_MS[tone] }];
}

export function expireToasts(items: readonly ToastItem[], now: number): ToastItem[] {
  return items.filter((item) => item.expiresAt > now);
}
