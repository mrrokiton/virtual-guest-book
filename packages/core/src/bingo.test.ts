import { describe, expect, it } from 'vitest';
import { bingoProgress } from './bingo';

describe('bingoProgress', () => {
  it('prioritizes corrections over missing submissions', () => {
    expect(
      bingoProgress({
        taskCount: 4,
        submittedCount: 2,
        pendingCount: 0,
        rejectedCount: 1,
        acceptedCount: 1,
      }),
    ).toBe('needs_correction');
  });

  it('distinguishes incomplete, awaiting and completed progress', () => {
    expect(
      bingoProgress({
        taskCount: 2,
        submittedCount: 1,
        pendingCount: 1,
        rejectedCount: 0,
        acceptedCount: 0,
      }),
    ).toBe('incomplete');
    expect(
      bingoProgress({
        taskCount: 2,
        submittedCount: 2,
        pendingCount: 1,
        rejectedCount: 0,
        acceptedCount: 1,
      }),
    ).toBe('awaiting_verification');
    expect(
      bingoProgress({
        taskCount: 2,
        submittedCount: 2,
        pendingCount: 0,
        rejectedCount: 0,
        acceptedCount: 2,
      }),
    ).toBe('completed');
  });
});
