import type { Metadata, Viewport } from 'next';
import { ThemeToggle } from '@/components/theme-toggle';
import { THEME_COLORS, colorSchemeInitScript } from '@/lib/color-scheme';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Wirtualna księga gości', template: '%s · Wirtualna księga gości' },
  description: 'Wspólna galeria zdjęć i filmów z wesela, bez instalowania aplikacji.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: THEME_COLORS.light,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: colorSchemeInitScript() }} />
      </head>
      <body>
        <ThemeToggle />
        {children}
      </body>
    </html>
  );
}
