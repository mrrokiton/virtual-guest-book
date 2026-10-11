import { describe, expect, it } from 'vitest';
import { resolveColorScheme } from './color-scheme';

describe('resolveColorScheme', () => {
  it('keeps an explicit choice over the system preference', () => {
    expect(resolveColorScheme('dark', false)).toBe('dark');
    expect(resolveColorScheme('light', true)).toBe('light');
  });

  it('follows the system when nothing is stored', () => {
    expect(resolveColorScheme(null, true)).toBe('dark');
    expect(resolveColorScheme(null, false)).toBe('light');
  });

  it('ignores an unknown stored value', () => {
    expect(resolveColorScheme('sepia', true)).toBe('dark');
    expect(resolveColorScheme('', false)).toBe('light');
  });
});
