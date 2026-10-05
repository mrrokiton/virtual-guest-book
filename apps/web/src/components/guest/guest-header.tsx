'use client';

import { WifiOff } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function GuestSessionLost() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-serif text-2xl">Sesja wygasła</h1>
      <p className="text-muted-foreground">
        PIN mógł zostać zmieniony. Podaj go ponownie, aby wrócić do galerii.
      </p>
      <Button onClick={() => window.location.reload()}>Wpisz PIN</Button>
    </main>
  );
}

function SectionLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
      )}
    >
      {children}
    </Link>
  );
}

export function GuestHeader({
  slug,
  headline,
  section,
  musicEnabled,
  degraded,
}: {
  slug: string;
  headline: string;
  section: 'photos' | 'music';
  musicEnabled: boolean;
  degraded: boolean;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <h1 className="truncate font-serif text-xl">{headline}</h1>
        {degraded && (
          <span
            className="flex items-center gap-1 text-xs text-muted-foreground"
            title="Odświeżanie co kilkanaście sekund"
          >
            <WifiOff className="size-3.5" /> Tryb oszczędny
          </span>
        )}
      </div>
      {musicEnabled ? (
        <nav
          aria-label="Sekcje"
          className="mx-auto mt-2 flex max-w-5xl gap-1 rounded-lg bg-muted p-0.5"
        >
          <SectionLink href={`/w/${slug}`} active={section === 'photos'}>
            Zdjęcia
          </SectionLink>
          <SectionLink href={`/w/${slug}/music`} active={section === 'music'}>
            Utwory
          </SectionLink>
        </nav>
      ) : null}
    </header>
  );
}
