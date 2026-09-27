import { adminCanEdit, MAX_UPLOAD_DAYS, roleCan } from '@vgb/core';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Alert, Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { toWarsawDateInput } from '@/lib/dates';
import { requireWeddingAccess } from '@/lib/session';
import { rotatePinAction, updateWeddingAction } from '../../../actions';

export default async function WeddingSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { wedding, role } = await requireWeddingAccess(id, 'wedding.view');
  const editable = adminCanEdit(wedding) && roleCan(role, 'wedding.edit');

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardTitle>Ustawienia wesela</CardTitle>
        {!editable ? (
          <Alert className="mb-4">W tym stanie wesela ustawień nie można już zmieniać.</Alert>
        ) : null}
        <ActionForm action={updateWeddingAction} className="space-y-4">
          <input type="hidden" name="weddingId" value={wedding.id} />
          <fieldset disabled={!editable} className="space-y-4">
            <Field label="Nazwa" htmlFor="name">
              <Input id="name" name="name" defaultValue={wedding.name} required maxLength={120} />
            </Field>
            <Field label="Data wesela" htmlFor="eventDate">
              <Input
                id="eventDate"
                name="eventDate"
                type="date"
                defaultValue={toWarsawDateInput(wedding.eventDate)}
                required
              />
            </Field>
            <Field label="Dni na dodawanie zdjęć po weselu" htmlFor="uploadDays">
              <Input
                id="uploadDays"
                name="uploadDays"
                type="number"
                min={1}
                max={MAX_UPLOAD_DAYS}
                defaultValue={wedding.uploadDays}
                required
              />
            </Field>
            <Field
              label="Nagłówek na stronie gościa i karcie"
              htmlFor="headline"
              hint="Np. „Ania & Tomek”. Domyślnie nazwa wesela."
            >
              <Input
                id="headline"
                name="headline"
                defaultValue={wedding.theme.headline ?? ''}
                maxLength={200}
              />
            </Field>
            <Field label="Kolor akcentu" htmlFor="accent">
              <Input
                id="accent"
                name="accent"
                type="color"
                defaultValue={wedding.theme.accent ?? '#7c4d3a'}
                className="h-11 w-20 p-1"
              />
            </Field>
            <SubmitButton>Zapisz</SubmitButton>
          </fieldset>
        </ActionForm>
      </Card>

      {roleCan(role, 'wedding.rotate_pin') ? (
        <Card>
          <CardTitle>Zmień PIN</CardTitle>
          <CardDescription>
            Przydaje się, gdy PIN trafił do osób spoza wesela. Pamiętaj, że wydrukowane karty
            przestaną działać.
          </CardDescription>
          <ActionForm action={rotatePinAction} className="space-y-4">
            <input type="hidden" name="weddingId" value={wedding.id} />
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="revokeSessions" className="mt-1" />
              <span>Wyloguj też wszystkich gości (będą musieli podać nowy PIN)</span>
            </label>
            <SubmitButton variant="outline">Wygeneruj nowy PIN</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
