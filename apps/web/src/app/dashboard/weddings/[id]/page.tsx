import { addDays, DELETION_GRACE_DAYS, planLimits, roleCan } from '@vgb/core';
import { weddingScope } from '@vgb/db';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { CopyButton } from '@/components/copy-button';
import { buttonVariants } from '@/components/ui/button';
import { Alert, Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { qrSvg } from '@/lib/qr';
import { requireWeddingAccess } from '@/lib/session';
import { db } from '@/lib/server';
import { formatBytes, formatDate } from '@/lib/utils';
import { formatPin, guestUrl, weddingPin } from '@/lib/weddings';
import {
  activateWeddingAction,
  requestDeletionAction,
  requestExportAction,
  restoreWeddingAction,
} from '../../actions';

const AUDIT_LABELS: Record<string, string> = {
  'wedding.created': 'Utworzono wesele',
  'wedding.updated': 'Zmieniono ustawienia',
  'wedding.activated': 'Aktywowano wesele',
  'wedding.pin_rotated': 'Zmieniono PIN',
  'wedding.deletion_requested': 'Zlecono usunięcie',
  'wedding.restored': 'Anulowano usunięcie',
  'wedding.became_read_only': 'Zamknięto dodawanie zdjęć',
  'wedding.archived': 'Zarchiwizowano galerię',
  'wedding.deletion_scheduled': 'Zaplanowano automatyczne usunięcie',
  'wedding.approved': 'Zatwierdzone przez administratora platformy',
  'wedding.blocked': 'Zablokowane przez administratora platformy',
  'wedding.unblocked': 'Odblokowane przez administratora platformy',
  'media.hide': 'Ukryto plik',
  'media.unhide': 'Przywrócono plik',
  'media.delete': 'Usunięto plik',
  'media.guest_delete': 'Gość usunął swój plik',
  'member.invited': 'Wysłano zaproszenie',
  'member.joined': 'Dołączył współadministrator',
  'member.removed': 'Usunięto współadministratora',
  'export.requested': 'Zlecono paczkę ZIP',
  'export.ready': 'Paczka ZIP gotowa',
};

export default async function WeddingOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { wedding, role } = await requireWeddingAccess(id, 'wedding.view');
  const scope = weddingScope(db(), wedding.id);
  const [usage, latestExport, trail] = await Promise.all([
    scope.media.usage(),
    scope.exports.latest(),
    scope.auditTrail(10),
  ]);
  const limits = planLimits(wedding.plan);
  const url = guestUrl(wedding.slug);
  const pin = formatPin(weddingPin(wedding));
  const svg = await qrSvg(url);
  const can = (a: Parameters<typeof roleCan>[1]) => roleCan(role, a);
  const archiveEndsAt = addDays(wedding.archiveAt, limits.archiveDays);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {wedding.status === 'draft' && !wedding.approvedAt ? (
        <Alert className="lg:col-span-2">
          Wesele czeka na zatwierdzenie przez administratora platformy. Do tego czasu goście nie
          mają dostępu. Możesz już przygotować ustawienia, a aktywujesz wesele po zatwierdzeniu.
        </Alert>
      ) : null}

      {wedding.status === 'draft' && wedding.approvedAt ? (
        <Alert className="lg:col-span-2">
          Wesele jest w szkicu: goście jeszcze nie mają dostępu. Sprawdź ustawienia i aktywuj je,
          gdy będziesz gotowy.
          {can('wedding.activate') ? (
            <ActionForm action={activateWeddingAction} className="mt-3">
              <input type="hidden" name="weddingId" value={wedding.id} />
              <SubmitButton>Aktywuj wesele</SubmitButton>
            </ActionForm>
          ) : null}
        </Alert>
      ) : null}

      {wedding.status === 'pending_deletion' && wedding.purgeAt ? (
        <Alert tone="danger" className="lg:col-span-2">
          Wesele zostanie trwale usunięte {formatDate(wedding.purgeAt, true)} razem ze wszystkimi
          zdjęciami i filmami.
          {can('wedding.restore') ? (
            <ActionForm action={restoreWeddingAction} className="mt-3">
              <input type="hidden" name="weddingId" value={wedding.id} />
              <SubmitButton variant="outline">Anuluj usunięcie</SubmitButton>
            </ActionForm>
          ) : null}
        </Alert>
      ) : null}

      {wedding.blockedAt ? (
        <Alert tone="danger" className="lg:col-span-2">
          Wesele zostało zablokowane przez administratora platformy
          {wedding.blockedReason ? `: ${wedding.blockedReason}` : ''}. Goście nie mają dostępu.
        </Alert>
      ) : null}

      <Card>
        <CardTitle>Dostęp dla gości</CardTitle>
        <CardDescription>
          Goście skanują kod QR i podają PIN. Nie muszą zakładać konta.
        </CardDescription>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div
            className="w-40 shrink-0 rounded-lg border border-border p-2"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <div className="min-w-0 space-y-3 text-sm">
            <div>
              <p className="text-muted-foreground">Link</p>
              <p className="break-all font-mono text-xs" data-testid="guest-url">
                {url}
              </p>
              <CopyButton value={url} className="mt-1" />
            </div>
            <div>
              <p className="text-muted-foreground">PIN wesela</p>
              <p className="font-mono text-2xl tracking-widest" data-testid="wedding-pin">
                {pin}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/dashboard/weddings/${wedding.id}/print`}
                className={buttonVariants({ size: 'sm' })}
              >
                Karta do druku
              </Link>
              <a
                href={`/api/admin/weddings/${wedding.id}/qr`}
                className={buttonVariants({ size: 'sm', variant: 'outline' })}
              >
                Pobierz QR (PNG)
              </a>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Harmonogram</CardTitle>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Dodawanie zdjęć do</dt>
            <dd>{formatDate(wedding.readOnlyAt, true)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Galeria dla gości do</dt>
            <dd>{formatDate(wedding.archiveAt)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Automatyczne usunięcie</dt>
            <dd>{formatDate(addDays(archiveEndsAt, DELETION_GRACE_DAYS))}</dd>
          </div>
        </dl>
        <h3 className="mt-6 mb-2 text-base font-semibold">Wykorzystanie</h3>
        <p className="text-sm">
          {usage.total} / {limits.maxMediaPerWedding} plików · {usage.videos} /{' '}
          {limits.maxVideosPerWedding} filmów (do {limits.maxVideoSeconds} s)
        </p>
      </Card>

      <Card>
        <CardTitle>Paczka ZIP</CardTitle>
        <CardDescription>
          Wszystkie widoczne zdjęcia (w pełnej rozdzielczości) i filmy w jednym pliku. Tworzymy ją
          też automatycznie po zamknięciu galerii.
        </CardDescription>
        {latestExport ? (
          <p className="mb-3 text-sm">
            Ostatnia paczka: {formatDate(latestExport.createdAt, true)} ·{' '}
            {latestExport.status === 'ready'
              ? `gotowa (${latestExport.mediaCount} plików, ${formatBytes(latestExport.sizeBytes ?? 0)})`
              : latestExport.status === 'failed'
                ? 'błąd, spróbuj ponownie'
                : 'w przygotowaniu…'}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {latestExport?.status === 'ready' ? (
            <a
              href={`/api/admin/weddings/${wedding.id}/export`}
              className={buttonVariants({ size: 'sm' })}
            >
              Pobierz ZIP
            </a>
          ) : null}
          {can('export.download') ? (
            <ActionForm action={requestExportAction}>
              <input type="hidden" name="weddingId" value={wedding.id} />
              <SubmitButton size="sm" variant="outline">
                Przygotuj nową paczkę
              </SubmitButton>
            </ActionForm>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardTitle>Ostatnie zdarzenia</CardTitle>
        {trail.length === 0 ? (
          <p className="text-sm text-muted-foreground">Brak zdarzeń.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-sm">
            {trail.map((e) => (
              <li key={e.id} className="flex justify-between gap-4">
                <span>{AUDIT_LABELS[e.action] ?? e.action}</span>
                <span className="shrink-0 text-muted-foreground">
                  {formatDate(e.createdAt, true)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {can('wedding.delete') && wedding.status !== 'pending_deletion' ? (
        <Card className="border-red-200 lg:col-span-2">
          <CardTitle>Usuń wesele</CardTitle>
          <CardDescription>
            Wesele i wszystkie pliki zostaną trwale usunięte po {DELETION_GRACE_DAYS} dniach. Do
            tego czasu możesz cofnąć decyzję.
          </CardDescription>
          <ActionForm
            action={requestDeletionAction}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <input type="hidden" name="weddingId" value={wedding.id} />
            <div className="flex-1">
              <Field label={`Wpisz „${wedding.name}”, aby potwierdzić`} htmlFor="confirm">
                <Input id="confirm" name="confirm" required autoComplete="off" />
              </Field>
            </div>
            <SubmitButton variant="destructive">Usuń wesele</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
