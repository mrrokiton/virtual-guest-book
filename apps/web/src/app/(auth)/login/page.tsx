'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';
import { authErrorMessage } from '@/lib/auth-errors';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'password' | 'link'>('password');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email'));
    setPending(true);
    setError(null);
    if (mode === 'password') {
      const { error } = await authClient.signIn.email({
        email,
        password: String(form.get('password')),
        callbackURL: '/dashboard',
      });
      setPending(false);
      if (error) setError(authErrorMessage(error));
      else router.push('/dashboard');
    } else {
      const { error } = await authClient.signIn.magicLink({ email, callbackURL: '/dashboard' });
      setPending(false);
      if (error) setError(authErrorMessage(error));
      else setLinkSent(true);
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Logowanie do panelu</h1>
      <div className="mb-6 grid grid-cols-2 rounded-lg bg-muted p-1 text-sm" role="tablist">
        {(['password', 'link'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setError(null);
              setLinkSent(false);
            }}
            className={`rounded-md py-2 ${mode === m ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
          >
            {m === 'password' ? 'Hasło' : 'Link na e-mail'}
          </button>
        ))}
      </div>
      {linkSent ? (
        <Alert tone="success">
          Jeśli konto istnieje, wysłaliśmy link do logowania. Sprawdź skrzynkę.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="E-mail" htmlFor="email">
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </Field>
          {mode === 'password' ? (
            <Field label="Hasło" htmlFor="password">
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </Field>
          ) : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Chwileczkę…' : mode === 'password' ? 'Zaloguj się' : 'Wyślij link'}
          </Button>
        </form>
      )}
      <div className="mt-6 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-muted-foreground underline">
          Nie pamiętam hasła
        </Link>
        <Link href="/register" className="text-primary underline">
          Załóż konto
        </Link>
      </div>
    </div>
  );
}
