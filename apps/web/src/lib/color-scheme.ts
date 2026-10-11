export const COLOR_SCHEME_KEY = 'vgb:color-scheme';

export const THEME_COLORS = {
  light: '#fbf8f4',
  dark: '#1c1614',
} as const;

export type ColorScheme = keyof typeof THEME_COLORS;

/** Stored light/dark wins. Anything else follows the system preference. */
export function resolveColorScheme(stored: string | null, prefersDark: boolean): ColorScheme {
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersDark ? 'dark' : 'light';
}

/** Blocking head script: sets `dark` before paint. Ignores a missing localStorage. */
export function colorSchemeInitScript(): string {
  const key = JSON.stringify(COLOR_SCHEME_KEY);
  const dark = JSON.stringify(THEME_COLORS.dark);
  const light = JSON.stringify(THEME_COLORS.light);
  return `(function(){try{var s=localStorage.getItem(${key});var d=s==='dark'||(s!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',d?${dark}:${light});}catch(e){}})();`;
}
