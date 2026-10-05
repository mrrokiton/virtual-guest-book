import { guestCanView } from '@vgb/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DjForm } from '@/components/guest/dj-form';
import { findWedding } from '@/lib/guest';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Wejście DJ-a',
  robots: { index: false, follow: false },
  referrer: 'same-origin',
};

export default async function DjEntryPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const wedding = await findWedding(slug);
  if (!wedding || wedding.status === 'deleted' || !guestCanView(wedding)) notFound();

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 py-10">
      <header className="text-center">
        <p className="text-sm tracking-widest text-muted-foreground uppercase">Dla DJ-a</p>
        <h1 className="mt-2 font-serif text-3xl">
          {wedding.theme.headline?.trim() || wedding.name}
        </h1>
        <p className="mt-2 text-muted-foreground">
          Ten link daje dostęp gościa oraz listę propozycji muzycznych. Nie otwiera panelu pary.
        </p>
      </header>
      <DjForm slug={slug} token={token} />
    </main>
  );
}
