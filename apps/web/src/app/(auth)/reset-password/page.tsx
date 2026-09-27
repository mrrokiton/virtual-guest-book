'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';
import { authErrorMessage } from '@/lib/auth-errors';

function ResetForm() {
  const token = useSearchParams().get('token');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) return <Alert tone="danger">Link jest nieprawidłowy. Poproś o nowy.</Alert>;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.resetPassword({
      newPassword: String(new FormData(e.currentTarget).get('password')),
      token: token!,
    });
    setPending(false);
    if (error) setError(authErrorMessage(error));
    else setDone(true);
  }

  if (done) {
    return (
      <Alert tone="success">
        Hasło zmienione.{' '}
        <Link href="/login" className="underline">
          Zaloguj się
        </Link>
        .
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Nowe hasło" htmlFor="password" hint="Co najmniej 10 znaków.">
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
        Zapisz hasło
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Ustaw nowe hasło</h1>
      <Suspense>
        <ResetForm />
      </Suspense>
    </div>
  );
}
