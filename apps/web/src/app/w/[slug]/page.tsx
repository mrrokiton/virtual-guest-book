import {
  guestCanUpload,
  guestCanView,
  musicCreateCap,
  planLimits,
  VIDEO_DURATION_TOLERANCE_S,
} from '@vgb/core';
import { weddingScope, type Wedding } from '@vgb/db';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { GuestApp } from '@/components/guest/guest-app';
import { PinForm } from '@/components/guest/pin-form';
import { findWedding, getGuestSession } from '@/lib/guest';
import { loadMusicModule, toMusicEntry } from '@/lib/music';
import { db, video } from '@/lib/server';
import { formatDate } from '@/lib/utils';
import { toGalleryItem } from '@/lib/weddings';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const wedding = await findWedding((await params).slug);
  return {
    title: wedding && wedding.status !== 'deleted' ? headlineOf(wedding) : 'Księga gości',
    robots: { index: false, follow: false },
    referrer: 'same-origin',
  };
}

function headlineOf(w: Wedding): string {
  return w.theme.headline?.trim() || w.name;
}

function Shell({ wedding, children }: { wedding: Wedding; children: ReactNode }) {
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
    <Shell wedding={wedding}>
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm tracking-widest text-muted-foreground uppercase">
          {headlineOf(wedding)}
        </p>
        <h1 className="font-serif text-3xl">{title}</h1>
        <p className="text-muted-foreground">{text}</p>
      </main>
    </Shell>
  );
}

export default async function GuestPage({ params }: Props) {
  const { slug } = await params;
  const wedding = await findWedding(slug);
  if (!wedding || wedding.status === 'deleted') notFound();

  if (wedding.blockedAt) {
    return (
      <StateScreen
        wedding={wedding}
        title="Galeria jest niedostępna"
        text="Skontaktuj się z Parą Młodą."
      />
    );
  }
  if (wedding.status === 'draft') {
    return (
      <StateScreen
        wedding={wedding}
        title="Już niedługo!"
        text={`Galeria zostanie otwarta przez Parę Młodą przed uroczystością (${formatDate(wedding.eventDate)}).`}
      />
    );
  }
  if (!guestCanView(wedding)) {
    return (
      <StateScreen
        wedding={wedding}
        title="Galeria została zamknięta"
        text="Dziękujemy za wszystkie wspólne chwile!"
      />
    );
  }

  const session = await getGuestSession(wedding);
  if (!session) {
    return (
      <Shell wedding={wedding}>
        <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 py-10">
          <header className="text-center">
            <p className="text-sm tracking-widest text-muted-foreground uppercase">Księga gości</p>
            <h1 className="mt-2 font-serif text-3xl">{headlineOf(wedding)}</h1>
            <p className="mt-2 text-muted-foreground">
              Podaj PIN z zaproszenia lub karteczki na stole.
            </p>
          </header>
          <PinForm slug={slug} />
        </main>
      </Shell>
    );
  }

  const limits = planLimits(wedding.plan);
  const now = new Date();
  const scope = weddingScope(db(), wedding.id);
  const musicModule = await loadMusicModule(wedding.id);
  let music = null;
  if (musicModule) {
    const capInput = await scope.music.durableCapInput(session.id);
    const [open, history] = await Promise.all([scope.music.listOpen(), scope.music.listHistory()]);
    music = {
      isDj: session.role === 'dj',
      canMutate: guestCanUpload(wedding, now),
      capRemaining: Math.max(0, musicCreateCap(capInput) - capInput.mine),
      atSafetyCap: capInput.mine >= 40,
      open: open.map((row) => toMusicEntry(row, session.id)),
      history: history.map((row) => toMusicEntry(row, session.id)),
    };
  }
  const page = await scope.media.gallery({ cursor: null, limit: 30 });
  const hasVideoThumb = video().name === 'cloudflare';

  return (
    <Shell wedding={wedding}>
      <GuestApp
        slug={slug}
        headline={headlineOf(wedding)}
        canUpload={guestCanUpload(wedding, now)}
        uploadClosesAt={wedding.readOnlyAt?.toISOString() ?? null}
        limits={{
          maxPhotoBytes: limits.maxPhotoBytes,
          maxVideoBytes: limits.maxVideoBytes,
          maxVideoSeconds: limits.maxVideoSeconds,
          videoToleranceSeconds: VIDEO_DURATION_TOLERANCE_S,
        }}
        initialItems={page.items.map((m) => toGalleryItem(slug, m, hasVideoThumb))}
        initialCursor={page.nextCursor}
        music={music}
      />
    </Shell>
  );
}
