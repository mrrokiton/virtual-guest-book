import { adminCanEdit, MAX_UPLOAD_DAYS, MUSIC_MODULE_KEY, roleCan } from '@vgb/core';
import { weddingScope } from '@vgb/db';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Alert, Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { toWarsawDateInput } from '@/lib/dates';
import { requireWeddingAccess } from '@/lib/session';
import { db } from '@/lib/server';
import { formatDate } from '@/lib/utils';
import {
  createDjLinkAction,
  revokeDjLinkAction,
  rotatePinAction,
  setMusicModuleAction,
  updateWeddingAction,
} from '../../../actions';

export default async function WeddingSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { wedding, role } = await requireWeddingAccess(id, 'wedding.view');
  const editable = adminCanEdit(wedding) && roleCan(role, 'wedding.edit');
  const scope = weddingScope(db(), wedding.id);
  const [modules, djLinks] = await Promise.all([scope.modules.list(), scope.djLinks.list()]);
  const music = modules.find((item) => item.moduleKey === MUSIC_MODULE_KEY);
  const activeLinks = djLinks.filter((link) => !link.revokedAt);

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

      {editable ? (
        <Card className="lg:col-span-2">
          <CardTitle>Propozycje muzyczne</CardTitle>
          <CardDescription>
            Goście zgłaszają utwory i gatunki w galerii. DJ dostaje osobny link i nie widzi panelu
            pary. Lista propozycji jest tylko w strefie gościa.
          </CardDescription>
          <ActionForm action={setMusicModuleAction} className="space-y-3">
            <input type="hidden" name="weddingId" value={wedding.id} />
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={music?.enabled ?? false}
                className="mt-1"
              />
              <span>Włącz propozycje na stronie gościa</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="fairQueue"
                defaultChecked={music?.config.fairQueue === true}
                className="mt-1"
              />
              <span>
                Sprawiedliwa kolejka: pierwsze 3 pozycje zostają, dalsze faworyzują gości z mniejszą
                liczbą otwartych zgłoszeń.
              </span>
            </label>
            <SubmitButton>Zapisz propozycje</SubmitButton>
          </ActionForm>

          <h3 className="mt-6 mb-2 text-base font-semibold">Linki dla DJ-a</h3>
          <ActionForm action={createDjLinkAction} resetOnSuccess className="space-y-3">
            <input type="hidden" name="weddingId" value={wedding.id} />
            <Field label="Nazwa (tylko dla Was)" htmlFor="dj-label">
              <Input id="dj-label" name="label" maxLength={80} placeholder="np. DJ Marek" />
            </Field>
            <SubmitButton variant="outline">Utwórz link</SubmitButton>
          </ActionForm>
          {activeLinks.length ? (
            <ul className="mt-4 space-y-2 text-sm">
              {activeLinks.map((link) => (
                <li key={link.id} className="flex items-center justify-between gap-2">
                  <span>
                    {link.label || 'DJ'}{' '}
                    <span className="text-muted-foreground">· {formatDate(link.createdAt)}</span>
                  </span>
                  <ActionForm action={revokeDjLinkAction}>
                    <input type="hidden" name="weddingId" value={wedding.id} />
                    <input type="hidden" name="linkId" value={link.id} />
                    <SubmitButton size="sm" variant="ghost">
                      Odwołaj
                    </SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Brak aktywnych linków.</p>
          )}
        </Card>
      ) : null}
    </div>
  );
}
