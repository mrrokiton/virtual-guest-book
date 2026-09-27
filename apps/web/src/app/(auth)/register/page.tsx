'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';
import { authErrorMessage } from '@/lib/auth-errors';

export default function RegisterPage() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email'));
    setPending(true);
    setError(null);
    const { error } = await authClient.signUp.email({
      name: String(form.get('name')),
      email,
      password: String(form.get('password')),
      callbackURL: '/dashboard',
    });
    setPending(false);
    if (error) setError(authErrorMessage(error));
    else setSentTo(email);
  }

  if (sentTo) {
    return (
      <div>
        <h1 className="mb-3 text-2xl font-semibold">Sprawdź skrzynkę</h1>
        <p className="text-muted-foreground">
          Wysłaliśmy link aktywacyjny na <strong>{sentTo}</strong>. Kliknij go, aby zalogować się do
          panelu.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Załóż konto</h1>
      <p className="mb-6 text-muted-foreground">
        Konto potrzebne jest tylko parze młodej. Goście nie muszą się rejestrować.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Imiona pary" htmlFor="name">
          <Input
            id="name"
            name="name"
            required
            maxLength={100}
            autoComplete="name"
            placeholder="Ania i Tomek"
          />
        </Field>
        <Field label="E-mail" htmlFor="email">
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </Field>
        <Field label="Hasło" htmlFor="password" hint="Co najmniej 10 znaków.">
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
          />
        </Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? 'Tworzenie konta…' : 'Załóż konto'}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        Masz już konto?{' '}
        <Link href="/login" className="text-primary underline">
          Zaloguj się
        </Link>
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Zakładając konto akceptujesz{' '}
        <Link href="/regulamin" className="underline">
          regulamin
        </Link>{' '}
        i{' '}
        <Link href="/prywatnosc" className="underline">
          politykę prywatności
        </Link>
        .
      </p>
    </div>
  );
}
