'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';

export function DjForm({ slug, token }: { slug: string; token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/w/${slug}/dj`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          displayName: String(form.get('displayName') ?? '').trim() || undefined,
          acceptTerms: form.get('acceptTerms') === 'on',
        }),
      });
      if (res.ok) {
        router.push(`/w/${slug}`);
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'Coś poszło nie tak. Spróbuj ponownie.');
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
        <Label htmlFor="displayName">Twoje imię (opcjonalnie)</Label>
        <Input id="displayName" name="displayName" maxLength={60} autoComplete="given-name" />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="acceptTerms" required className="mt-1 size-4 accent-primary" />
        <span>
          Akceptuję{' '}
          <Link href="/regulamin" target="_blank" className="underline">
            regulamin
          </Link>
        </span>
      </label>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Chwileczkę…' : 'Wejdź jako DJ'}
      </Button>
    </form>
  );
}
