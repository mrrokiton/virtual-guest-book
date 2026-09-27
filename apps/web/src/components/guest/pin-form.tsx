'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';

export function PinForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/w/${slug}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: String(form.get('pin') ?? ''),
          displayName: String(form.get('displayName') ?? '').trim() || undefined,
          acceptTerms: form.get('acceptTerms') === 'on',
        }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; remaining?: number };
      let message = body.error ?? 'Coś poszło nie tak. Spróbuj ponownie.';
      if (res.status === 401 && typeof body.remaining === 'number' && body.remaining <= 3) {
        message += ` Pozostało prób: ${body.remaining}.`;
      }
      setError(message);
      setPending(false);
    } catch {
      setError('Brak połączenia z internetem.');
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pin">PIN</Label>
        <Input
          id="pin"
          name="pin"
          required
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={9}
          placeholder="np. K7M 2QX"
          className="h-14 text-center font-mono text-2xl tracking-[0.3em] uppercase"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="displayName">Twoje imię (opcjonalnie)</Label>
        <Input
          id="displayName"
          name="displayName"
          maxLength={60}
          autoComplete="given-name"
          placeholder="Widoczne przy Twoich zdjęciach"
        />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="acceptTerms" required className="mt-1 size-4 accent-primary" />
        <span>
          Akceptuję{' '}
          <Link href="/regulamin" target="_blank" className="underline">
            regulamin
          </Link>{' '}
          i{' '}
          <Link href="/prywatnosc" target="_blank" className="underline">
            politykę prywatności
          </Link>
          . Wiem, że dodane zdjęcia zobaczą wszyscy goście.
        </span>
      </label>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Sprawdzam…' : 'Wejdź do galerii'}
      </Button>
    </form>
  );
}
