import { guestCanUpload, guestCanView } from '@vgb/core';
import type { GuestSession, Wedding } from '@vgb/db';
import type { CSSProperties, ReactNode } from 'react';
import { PinForm } from '@/components/guest/pin-form';
import { findWedding, getGuestSession } from '@/lib/guest';
import { loadMusicModule } from '@/lib/music';
import { formatDate } from '@/lib/utils';

export function headlineOf(w: Wedding): string {
  return w.theme.headline?.trim() || w.name;
}

export function GuestShell({ wedding, children }: { wedding: Wedding; children: ReactNode }) {
  const style = wedding.theme.accent
    ? ({ '--color-primary': wedding.theme.accent } as CSSProperties)
    : undefined;
  return (
    <div style={style} className="min-h-dvh">
      {children}
    </div>
  );
}

function StateScreen({ wedding, title, text }: { wedding: Wedding; title: string; text: string }) {
  return (
    <GuestShell wedding={wedding}>
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm tracking-widest text-muted-foreground uppercase">
          {headlineOf(wedding)}
        </p>
        <h1 className="font-serif text-3xl">{title}</h1>
        <p className="text-muted-foreground">{text}</p>
      </main>
    </GuestShell>
  );
}

export type OpenGuest =
  | { status: 'missing' }
  | { status: 'gated'; node: ReactNode }
  | {
      status: 'ready';
      slug: string;
      wedding: Wedding;
      session: GuestSession;
      headline: string;
      musicEnabled: boolean;
      canUpload: boolean;
    };

export async function openGuest(slug: string): Promise<OpenGuest> {
  const wedding = await findWedding(slug);
  if (!wedding || wedding.status === 'deleted') return { status: 'missing' };

  if (wedding.blockedAt) {
    return {
      status: 'gated',
      node: (
        <StateScreen
          wedding={wedding}
          title="Galeria jest niedostępna"
          text="Skontaktuj się z Parą Młodą."
        />
      ),
    };
  }
  if (wedding.status === 'draft') {
    return {
      status: 'gated',
      node: (
        <StateScreen
          wedding={wedding}
          title="Już niedługo!"
          text={`Galeria zostanie otwarta przez Parę Młodą przed uroczystością (${formatDate(wedding.eventDate)}).`}
        />
      ),
    };
  }
  if (!guestCanView(wedding)) {
    return {
      status: 'gated',
      node: (
        <StateScreen
          wedding={wedding}
          title="Galeria została zamknięta"
          text="Dziękujemy za wszystkie wspólne chwile!"
        />
      ),
    };
  }

  const session = await getGuestSession(wedding);
  if (!session) {
    return {
      status: 'gated',
      node: (
        <GuestShell wedding={wedding}>
          <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 py-10">
            <header className="text-center">
              <p className="text-sm tracking-widest text-muted-foreground uppercase">
                Księga gości
              </p>
              <h1 className="mt-2 font-serif text-3xl">{headlineOf(wedding)}</h1>
              <p className="mt-2 text-muted-foreground">
                Podaj PIN z zaproszenia lub karteczki na stole.
              </p>
            </header>
            <PinForm slug={slug} />
          </main>
        </GuestShell>
      ),
    };
  }

  const now = new Date();
  return {
    status: 'ready',
    slug,
    wedding,
    session,
    headline: headlineOf(wedding),
    musicEnabled: (await loadMusicModule(wedding.id)) !== null,
    canUpload: guestCanUpload(wedding, now),
  };
}
