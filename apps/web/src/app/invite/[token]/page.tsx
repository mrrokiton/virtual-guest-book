import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { getUser } from '@/lib/session';
import { acceptInviteAction } from '../../dashboard/actions';

export const metadata = { title: 'Zaproszenie', robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getUser();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <Card>
        <CardTitle>Zaproszenie do współprowadzenia galerii</CardTitle>
        {user ? (
          <>
            <CardDescription>Zalogowano jako {user.email}.</CardDescription>
            <ActionForm action={acceptInviteAction}>
              <input type="hidden" name="token" value={token} />
              <SubmitButton className="w-full">Przyjmij zaproszenie</SubmitButton>
            </ActionForm>
          </>
        ) : (
          <>
            <CardDescription>
              Zaloguj się lub załóż konto na adres, na który przyszło zaproszenie, a potem wróć do
              tego linku.
            </CardDescription>
            <div className="flex gap-2">
              <Link href="/login" className={buttonVariants()}>
                Zaloguj się
              </Link>
              <Link href="/register" className={buttonVariants({ variant: 'outline' })}>
                Załóż konto
              </Link>
            </div>
          </>
        )}
      </Card>
    </main>
  );
}
