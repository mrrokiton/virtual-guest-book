'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import type { MusicPanelData } from '@/lib/music';

function authorLabel(name: string | null): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : 'Gość';
}

export function MusicPanel({
  slug,
  data,
  reload,
  moduleOff,
}: {
  slug: string;
  data: MusicPanelData;
  reload: () => Promise<void>;
  moduleOff: boolean;
}) {
  const [kind, setKind] = useState<'track' | 'genre'>('track');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function createSuggestion() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/w/${slug}/music`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, body }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? 'Nie udało się dodać propozycji.');
        return;
      }
      setBody('');
      await reload();
    } catch {
      setError('Brak połączenia z internetem.');
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/w/${slug}/music/${id}`, { method: 'DELETE' }).catch(() => null);
    if (!res || (!res.ok && res.status !== 404)) {
      setError('Nie udało się usunąć propozycji.');
      return;
    }
    await reload();
  }

  async function setStatus(id: string, status: 'open' | 'played' | 'skipped') {
    setError(null);
    const res = await fetch(`/api/w/${slug}/music/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    if (!res?.ok) {
      const payload = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      setError(payload?.error ?? 'Nie udało się zmienić statusu.');
      return;
    }
    await reload();
  }

  return (
    <section className="mx-auto max-w-lg px-4 py-8">
      <h2 className="font-serif text-2xl">Propozycje dla DJ-a</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Utwory i gatunki, które goście chcą usłyszeć. Kolejność jest wspólna dla wszystkich.
      </p>
      {error ? (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      ) : null}

      {moduleOff ? (
        <Alert className="mt-4">
          Propozycje muzyczne są wyłączone. Listę możesz nadal oglądać.
        </Alert>
      ) : data.canMutate ? (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void createSuggestion();
          }}
        >
          <div className="flex gap-2">
            <Button
              type="button"
              variant={kind === 'track' ? 'primary' : 'outline'}
              onClick={() => setKind('track')}
            >
              Utwór
            </Button>
            <Button
              type="button"
              variant={kind === 'genre' ? 'primary' : 'outline'}
              onClick={() => setKind('genre')}
            >
              Gatunek
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="music-body">{kind === 'track' ? 'Utwór' : 'Gatunek'}</Label>
            <Input
              id="music-body"
              value={body}
              maxLength={120}
              onChange={(e) => setBody(e.target.value)}
              placeholder={kind === 'track' ? 'np. ABBA, Dancing Queen' : 'np. disco lat 80.'}
              required
            />
          </div>
          <Button type="submit" disabled={pending || data.capRemaining <= 0}>
            {pending ? 'Dodawanie…' : 'Dodaj propozycję'}
          </Button>
          <p className="text-xs text-muted-foreground">
            {data.capRemaining > 0
              ? `Możesz dodać jeszcze ${data.capRemaining}. Limit rośnie, gdy inni goście też zgłaszają.`
              : data.atSafetyCap
                ? 'Osiągnięto limit 40 propozycji na to urządzenie.'
                : 'Teraz nie możesz dodać kolejnej propozycji. Limit wzrośnie, gdy inni goście też coś zgłoszą.'}
          </p>
        </form>
      ) : (
        <Alert className="mt-4">
          Dodawanie propozycji jest już zamknięte. Listę możesz nadal oglądać.
        </Alert>
      )}

      <h3 className="mt-6 text-sm font-medium tracking-wide text-muted-foreground uppercase">
        Kolejka
      </h3>
      {data.open.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {data.history.length === 0 ? 'Nikt jeszcze nic nie zgłosił.' : 'Kolejka jest pusta.'}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {data.open.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium">{item.body}</p>
                <p className="text-sm">{authorLabel(item.authorName)}</p>
                <p className="text-xs text-muted-foreground">
                  {item.kind === 'track' ? 'Utwór' : 'Gatunek'}
                </p>
              </div>
              {data.canMutate && !moduleOff ? (
                <div className="flex shrink-0 flex-col gap-2">
                  {data.isDj ? (
                    <>
                      <Button
                        size="sm"
                        variant="success"
                        onClick={() => void setStatus(item.id, 'played')}
                      >
                        Zagrane
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void setStatus(item.id, 'skipped')}
                      >
                        Pomiń
                      </Button>
                    </>
                  ) : null}
                  {item.mine ? (
                    <Button size="sm" variant="destructive" onClick={() => void remove(item.id)}>
                      Usuń
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {data.history.length > 0 ? (
        <>
          <h3 className="mt-6 text-sm font-medium tracking-wide text-muted-foreground uppercase">
            Historia
          </h3>
          <ul className="mt-2 divide-y divide-border">
            {data.history.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{item.body}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.status === 'played' ? 'Zagrane' : 'Pominięte'} ·{' '}
                    {authorLabel(item.authorName)}
                  </p>
                </div>
                {data.isDj && data.canMutate && !moduleOff ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => void setStatus(item.id, 'open')}
                  >
                    Cofnij do kolejki
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
