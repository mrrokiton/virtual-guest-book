import { roleCan } from '@vgb/core';
import { listPendingInvites, weddingScope } from '@vgb/db';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Badge, Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { requireWeddingAccess } from '@/lib/session';
import { db } from '@/lib/server';
import { formatDate } from '@/lib/utils';
import { inviteCoAdminAction, removeMemberAction, revokeInviteAction } from '../../../actions';

export default async function WeddingTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { wedding, role, user } = await requireWeddingAccess(id, 'wedding.view');
  const canInvite = roleCan(role, 'wedding.invite');
  const [members, invites] = await Promise.all([
    weddingScope(db(), wedding.id).members.list(),
    canInvite ? listPendingInvites(db(), wedding.id) : Promise.resolve([]),
  ]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardTitle>Osoby z dostępem do panelu</CardTitle>
        <ul className="mt-3 divide-y divide-border">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{m.name}</p>
                <p className="truncate text-sm text-muted-foreground">{m.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge>{m.role === 'owner' ? 'Właściciel' : 'Współadministrator'}</Badge>
                {canInvite && m.role === 'co_admin' && m.userId !== user.id ? (
                  <ActionForm action={removeMemberAction}>
                    <input type="hidden" name="weddingId" value={wedding.id} />
                    <input type="hidden" name="userId" value={m.userId} />
                    <SubmitButton size="sm" variant="ghost">
                      Usuń
                    </SubmitButton>
                  </ActionForm>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {canInvite ? (
        <Card>
          <CardTitle>Zaproś współadministratora</CardTitle>
          <CardDescription>
            Np. świadka lub wedding plannera. Może moderować zdjęcia i zmieniać ustawienia, ale nie
            usunie wesela.
          </CardDescription>
          <ActionForm action={inviteCoAdminAction} resetOnSuccess className="space-y-3">
            <input type="hidden" name="weddingId" value={wedding.id} />
            <Field label="E-mail" htmlFor="email">
              <Input id="email" name="email" type="email" required />
            </Field>
            <SubmitButton>Wyślij zaproszenie</SubmitButton>
          </ActionForm>
          {invites.length ? (
            <>
              <h3 className="mt-6 mb-2 text-base font-semibold">Oczekujące zaproszenia</h3>
              <ul className="space-y-2 text-sm">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {i.email}{' '}
                      <span className="text-muted-foreground">· do {formatDate(i.expiresAt)}</span>
                    </span>
                    <ActionForm action={revokeInviteAction}>
                      <input type="hidden" name="weddingId" value={wedding.id} />
                      <input type="hidden" name="inviteId" value={i.id} />
                      <SubmitButton size="sm" variant="ghost">
                        Anuluj
                      </SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
