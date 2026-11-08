import { describe, expect, it } from 'vitest';
import { expireToasts, pushToast, TOAST_MS, TOAST_VIEWPORT_CLASS } from './toast-state';

describe('bingo toasts', () => {
  it('expires success sooner than an error and drops duplicates in that window', () => {
    const first = pushToast([], 'Zdjęcie dodane.', 'success', 1_000, 'a');
    expect(first[0]?.expiresAt).toBe(1_000 + TOAST_MS.success);
    const duplicate = pushToast(first, 'Zdjęcie dodane.', 'success', 1_500, 'b');
    expect(duplicate).toHaveLength(1);
    const error = pushToast(duplicate, 'Nie udało się usunąć zdjęcia.', 'danger', 2_000, 'c');
    expect(error[1]?.expiresAt).toBe(2_000 + TOAST_MS.danger);
    expect(expireToasts(error, 1_000 + TOAST_MS.success)).toEqual([error[1]]);
  });

  it('does not block the page underneath', () => {
    expect(TOAST_VIEWPORT_CLASS).toContain('pointer-events-none');
  });
});
