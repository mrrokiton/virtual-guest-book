import { DEFAULT_UPLOAD_DAYS, MAX_UPLOAD_DAYS } from '@vgb/core';
import { listWeddingsForUser } from '@vgb/db';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Badge, Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { requireUser } from '@/lib/session';
import { db } from '@/lib/server';
import { formatDate } from '@/lib/utils';
import { STATUS_LABELS, STATUS_TONES } from '@/lib/weddings';
import { createWeddingAction } from './actions';

export default async function DashboardPage() {
  const user = await requireUser();
  const rows = await listWeddingsForUser(db(), user.id);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <section>
        <h1 className="mb-4 text-2xl font-semibold">Moje wesela</h1>
        {rows.length === 0 ? (
          <Card>
            <p className="text-muted-foreground">
              Nie masz jeszcze żadnego wesela. Utwórz pierwsze obok.
            </p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {rows.map(({ wedding, role }) => (
              <li key={wedding.id}>
                <Link
                  href={`/dashboard/weddings/${wedding.id}`}
                  className="block rounded-lg border border-border bg-card p-4 hover:border-primary/40"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{wedding.name}</span>
                    <Badge tone={STATUS_TONES[wedding.status]}>
                      {STATUS_LABELS[wedding.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatDate(wedding.eventDate)} ·{' '}
                    {role === 'owner' ? 'właściciel' : 'współadministrator'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card>
        <CardTitle>Nowe wesele</CardTitle>
        <CardDescription>Po utworzeniu dostaniesz kod QR i PIN dla gości.</CardDescription>
        <ActionForm action={createWeddingAction} className="space-y-4">
          <Field label="Nazwa" htmlFor="name">
            <Input
              id="name"
              name="name"
              required
              maxLength={120}
              placeholder="Wesele Ani i Tomka"
            />
          </Field>
          <Field label="Data wesela" htmlFor="eventDate">
            <Input id="eventDate" name="eventDate" type="date" required />
          </Field>
          <Field
            label="Ile dni po weselu goście mogą dodawać zdjęcia"
            htmlFor="uploadDays"
            hint={`Od 1 do ${MAX_UPLOAD_DAYS} dni.`}
          >
            <Input
              id="uploadDays"
              name="uploadDays"
              type="number"
              min={1}
              max={MAX_UPLOAD_DAYS}
              defaultValue={DEFAULT_UPLOAD_DAYS}
              required
            />
          </Field>
          <SubmitButton className="w-full" pendingText="Tworzenie…">
            Utwórz wesele
          </SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
