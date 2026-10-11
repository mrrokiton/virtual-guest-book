'use client';

import { Moon, Sun } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  COLOR_SCHEME_KEY,
  THEME_COLORS,
  resolveColorScheme,
  type ColorScheme,
} from '@/lib/color-scheme';

function readStored(): string | null {
  try {
    return localStorage.getItem(COLOR_SCHEME_KEY);
  } catch {
    return null;
  }
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyScheme(scheme: ColorScheme) {
  document.documentElement.classList.toggle('dark', scheme === 'dark');
  document.documentElement.style.colorScheme = scheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[scheme]);
}

export function ThemeToggle() {
  const [scheme, setScheme] = useState<ColorScheme>('light');
  const [explicit, setExplicit] = useState(false);

  useEffect(() => {
    const stored = readStored();
    const next = resolveColorScheme(stored, prefersDark());
    setScheme(next);
    setExplicit(stored === 'light' || stored === 'dark');
    applyScheme(next);
  }, []);

  useEffect(() => {
    if (explicit) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const next = resolveColorScheme(null, media.matches);
      setScheme(next);
      applyScheme(next);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [explicit]);

  const toggle = useCallback(() => {
    const next: ColorScheme = scheme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(COLOR_SCHEME_KEY, next);
    } catch {
      // Private mode: the choice lasts until reload.
    }
    setExplicit(true);
    setScheme(next);
    applyScheme(next);
  }, [scheme]);

  const toDark = scheme !== 'dark';
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggle}
      aria-label={toDark ? 'Włącz tryb ciemny' : 'Włącz tryb jasny'}
      className="no-print fixed z-40 size-11 shadow-sm"
      style={{
        top: 'max(0.75rem, env(safe-area-inset-top))',
        right: 'max(0.75rem, env(safe-area-inset-right))',
      }}
    >
      {toDark ? <Moon className="size-5" /> : <Sun className="size-5" />}
    </Button>
  );
}
