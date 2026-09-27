import { listAllWeddings, listTenants } from '@vgb/db';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Badge, Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { requirePlatformAdmin } from '@/lib/session';
import { db } from '@/lib/server';
import { formatDate } from '@/lib/utils';
import { STATUS_LABELS, STATUS_TONES } from '@/lib/weddings';
import { approveWeddingAction, setWeddingBlockedAction } from './actions';

export const metadata = { title: 'Platforma', robots: { index: false } };

const PAGE = 50;

export default async function PlatformAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requirePlatformAdmin();
  const page = Math.max(0, Number((await searchParams).page ?? 0) || 0);
  const [weddings, tenants] = await Promise.all([
    listAllWeddings(db(), { limit: PAGE, offset: page * PAGE }),
    listTenants(db()),
  ]);
  const pending = weddings.filter((w) => !w.approvedAt).length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Administracja platformy</h1>
        <Link href="/dashboard" className="text-sm underline">
          Panel
        </Link>
      </div>

      <Card className="mb-6">
        <CardTitle>Wesela</CardTitle>
        <CardDescription>
          Administrator platformy nie ma wglądu w zdjęcia. Może jedynie zablokować wesele, np. po
          zgłoszeniu nadużycia. Nowe wesele można aktywować dopiero po zatwierdzeniu.
          {pending > 0 ? ` Czeka na zatwierdzenie: ${pending}.` : ''}
        </CardDescription>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Wesele</th>
                <th className="py-2 pr-4">Konto</th>
                <th className="py-2 pr-4">Data</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Pliki</th>
                <th className="py-2 pr-4">Zatwierdzenie</th>
                <th className="py-2">Blokada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {weddings.map((w) => (
                <tr key={w.id}>
                  <td className="py-2 pr-4">{w.name}</td>
                  <td className="py-2 pr-4">{w.tenantName}</td>
                  <td className="py-2 pr-4">{formatDate(w.eventDate)}</td>
                  <td className="py-2 pr-4">
                    <Badge tone={STATUS_TONES[w.status]}>{STATUS_LABELS[w.status]}</Badge>
                  </td>
                  <td className="py-2 pr-4">{w.mediaCount}</td>
                  <td className="py-2 pr-4">
                    {w.approvedAt ? (
                      <span className="text-muted-foreground">{formatDate(w.approvedAt)}</span>
                    ) : (
                      <ActionForm action={approveWeddingAction}>
                        <input type="hidden" name="weddingId" value={w.id} />
                        <SubmitButton size="sm">Zatwierdź</SubmitButton>
                      </ActionForm>
                    )}
                  </td>
                  <td className="py-2">
                    <ActionForm
                      action={setWeddingBlockedAction}
                      className="flex items-center gap-2"
                    >
                      <input type="hidden" name="weddingId" value={w.id} />
                      <input type="hidden" name="blocked" value={w.blockedAt ? 'false' : 'true'} />
                      {w.blockedAt ? null : (
                        <Input name="reason" placeholder="Powód" className="h-8 w-40 text-sm" />
                      )}
                      <SubmitButton size="sm" variant={w.blockedAt ? 'outline' : 'destructive'}>
                        {w.blockedAt ? 'Odblokuj' : 'Zablokuj'}
                      </SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex gap-3 text-sm">
          {page > 0 ? <Link href={`/admin?page=${page - 1}`}>← Poprzednie</Link> : null}
          {weddings.length === PAGE ? (
            <Link href={`/admin?page=${page + 1}`}>Następne →</Link>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardTitle>Konta ({tenants.length})</CardTitle>
        <ul className="mt-2 divide-y divide-border text-sm">
          {tenants.map((t, i) => (
            <li key={`${t.id}-${i}`} className="flex justify-between gap-4 py-2">
              <span>{t.name}</span>
              <span className="text-muted-foreground">
                {t.ownerEmail} · {formatDate(t.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
