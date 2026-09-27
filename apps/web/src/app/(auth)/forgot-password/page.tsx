'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';
import { authErrorMessage } from '@/lib/auth-errors';

export default function ForgotPasswordPage() {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.requestPasswordReset({
      email: String(new FormData(e.currentTarget).get('email')),
      redirectTo: '/reset-password',
    });
    setPending(false);
    if (error) setError(authErrorMessage(error));
    else setDone(true);
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Reset hasła</h1>
      {done ? (
        <Alert tone="success">
          Jeśli konto istnieje, wysłaliśmy link do ustawienia nowego hasła.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="E-mail" htmlFor="email">
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </Field>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Button type="submit" className="w-full" disabled={pending}>
            Wyślij link
          </Button>
        </form>
      )}
    </div>
  );
}
