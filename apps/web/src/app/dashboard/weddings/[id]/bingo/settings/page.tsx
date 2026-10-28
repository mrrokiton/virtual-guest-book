import { adminCanEdit, BINGO_MODULE_KEY, roleCan } from '@vgb/core';
import { weddingScope } from '@vgb/db';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { buttonVariants } from '@/components/ui/button';
import { Alert, Badge, Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { requireWeddingAccess } from '@/lib/session';
import { db } from '@/lib/server';
import {
  moveBingoTaskAction,
  removeBingoTaskAction,
  removeBingoValidatorAction,
  saveBingoTaskAction,
  saveBingoValidatorAction,
  setBingoModuleAction,
} from '../actions';

export default async function BingoSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { wedding, role } = await requireWeddingAccess(id, 'wedding.view');
  const scope = weddingScope(db(), wedding.id);
  const [tasks, validators, enabled] = await Promise.all([
    scope.bingo.tasks.list(),
    scope.bingo.validators.list(),
    scope.modules.isEnabled(BINGO_MODULE_KEY),
  ]);
  const editable = adminCanEdit(wedding) && roleCan(role, 'bingo.manage');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Ustawienia Bingo</h2>
          <p className="text-sm text-muted-foreground">
            Zadania i osoby potwierdzające dla tego wesela.
          </p>
        </div>
        <Link
          href={`/dashboard/weddings/${wedding.id}/bingo`}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          ← Weryfikacja i postęp
        </Link>
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Stan funkcji</CardTitle>
          <Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'Aktywne' : 'Nieaktywne'}</Badge>
        </div>
        <CardDescription>
          Dodawanie zadań nie aktywuje Bingo. Po wyłączeniu dane zostają zachowane.
        </CardDescription>
        {!editable ? (
          <Alert className="mb-3">W tym stanie nie można zmienić konfiguracji.</Alert>
        ) : null}
        <ActionForm action={setBingoModuleAction}>
          <input type="hidden" name="weddingId" value={wedding.id} />
          <input type="hidden" name="enabled" value={enabled ? '' : 'on'} />
          <SubmitButton disabled={!editable} variant={enabled ? 'outline' : 'primary'}>
            {enabled ? 'Wyłącz Bingo' : 'Włącz Bingo'}
          </SubmitButton>
        </ActionForm>
      </Card>

      <Card>
        <CardTitle>Zadania</CardTitle>
        <CardDescription>Kolejność tutaj jest kolejnością widoczną dla gości.</CardDescription>
        <ActionForm action={saveBingoTaskAction} resetOnSuccess className="flex gap-2">
          <input type="hidden" name="weddingId" value={wedding.id} />
          <Input name="body" required maxLength={300} placeholder="Dodaj nowe zadanie" />
          <SubmitButton disabled={!editable}>Dodaj</SubmitButton>
        </ActionForm>
        <ul className="mt-4 divide-y divide-border">
          {tasks.map((task, index) => (
            <li key={task.id} className="space-y-2 py-3">
              <ActionForm action={saveBingoTaskAction} className="flex flex-col gap-2 sm:flex-row">
                <input type="hidden" name="weddingId" value={wedding.id} />
                <input type="hidden" name="taskId" value={task.id} />
                <Input name="body" defaultValue={task.body} required maxLength={300} />
                <SubmitButton disabled={!editable} variant="outline" size="sm">
                  Zapisz
                </SubmitButton>
              </ActionForm>
              <div className="flex flex-wrap gap-1">
                {(['up', 'down'] as const).map((direction) => (
                  <ActionForm key={direction} action={moveBingoTaskAction}>
                    <input type="hidden" name="weddingId" value={wedding.id} />
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="direction" value={direction} />
                    <SubmitButton
                      disabled={
                        !editable || (direction === 'up' ? index === 0 : index === tasks.length - 1)
                      }
                      variant="ghost"
                      size="sm"
                    >
                      {direction === 'up' ? '↑ Wyżej' : '↓ Niżej'}
                    </SubmitButton>
                  </ActionForm>
                ))}
                <ActionForm action={removeBingoTaskAction}>
                  <input type="hidden" name="weddingId" value={wedding.id} />
                  <input type="hidden" name="taskId" value={task.id} />
                  <SubmitButton disabled={!editable} variant="ghost" size="sm">
                    Usuń
                  </SubmitButton>
                </ActionForm>
              </div>
            </li>
          ))}
        </ul>
        {!tasks.length ? <p className="mt-4 text-sm text-muted-foreground">Brak zadań.</p> : null}
      </Card>

      <Card>
        <CardTitle>Osoby potwierdzające</CardTitle>
        <CardDescription>
          To prosta lista informacyjna. Te osoby nie otrzymują kont ani dostępu do panelu.
        </CardDescription>
        <ActionForm
          action={saveBingoValidatorAction}
          resetOnSuccess
          className="grid gap-2 sm:grid-cols-3"
        >
          <input type="hidden" name="weddingId" value={wedding.id} />
          <Field label="Imię i nazwisko" htmlFor="validator-name">
            <Input id="validator-name" name="fullName" required maxLength={120} />
          </Field>
          <Field label="Ksywka (opcjonalnie)" htmlFor="validator-nickname">
            <Input id="validator-nickname" name="nickname" maxLength={80} />
          </Field>
          <div className="self-end">
            <SubmitButton disabled={!editable}>Dodaj osobę</SubmitButton>
          </div>
        </ActionForm>
        <ul className="mt-4 space-y-3">
          {validators.map((validator) => (
            <li key={validator.id} className="rounded-lg border border-border p-3">
              <ActionForm
                action={saveBingoValidatorAction}
                className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
              >
                <input type="hidden" name="weddingId" value={wedding.id} />
                <input type="hidden" name="validatorId" value={validator.id} />
                <Input name="fullName" defaultValue={validator.fullName} required maxLength={120} />
                <Input name="nickname" defaultValue={validator.nickname ?? ''} maxLength={80} />
                <SubmitButton disabled={!editable} variant="outline" size="sm">
                  Zapisz
                </SubmitButton>
              </ActionForm>
              <ActionForm action={removeBingoValidatorAction} className="mt-1">
                <input type="hidden" name="weddingId" value={wedding.id} />
                <input type="hidden" name="validatorId" value={validator.id} />
                <SubmitButton disabled={!editable} variant="ghost" size="sm">
                  Usuń
                </SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
