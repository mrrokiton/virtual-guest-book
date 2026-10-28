import { bingoProgress, roleCan } from '@vgb/core';
import { weddingScope } from '@vgb/db';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { buttonVariants } from '@/components/ui/button';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { requireWeddingAccess } from '@/lib/session';
import { db } from '@/lib/server';
import { formatDate } from '@/lib/utils';
import { verifyBingoSubmissionAction } from './actions';

const STATUS_LABELS = {
  incomplete: 'Nieukończone',
  awaiting_verification: 'Oczekuje na weryfikację',
  needs_correction: 'Wymaga poprawek',
  completed: 'Ukończone',
} as const;

export default async function BingoAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { wedding, role } = await requireWeddingAccess(id, 'wedding.view');
  const scope = weddingScope(db(), wedding.id);
  const [tasks, submissions] = await Promise.all([
    scope.bingo.tasks.list(),
    scope.bingo.adminSubmissions(),
  ]);
  const grouped = new Map<string, typeof submissions>();
  for (const row of submissions) {
    const list = grouped.get(row.submission.guestSessionId) ?? [];
    list.push(row);
    grouped.set(row.submission.guestSessionId, list);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Bingo Imprezowe</h2>
          <p className="text-sm text-muted-foreground">Weryfikacja zdjęć i postęp uczestników.</p>
        </div>
        <Link
          href={`/dashboard/weddings/${wedding.id}/bingo/settings`}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Ustawienia Bingo
        </Link>
      </div>

      <section>
        <h3 className="mb-3 text-lg font-semibold">Zgłoszenia</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {submissions.map(({ submission, task, media, guestName }) => (
            <Card key={submission.id}>
              <img
                src={`/api/w/${wedding.slug}/media/${media.id}/file?v=large`}
                alt=""
                className="mb-3 aspect-video w-full rounded-lg bg-muted object-cover"
              />
              <CardTitle>{task.body}</CardTitle>
              <p className="text-sm">
                {guestName || 'Gość'} · {submission.guestSessionId.slice(0, 8)}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDate(submission.submittedAt ?? submission.createdAt, true)}
              </p>
              <div className="mt-2">
                <Badge
                  tone={
                    submission.status === 'accepted'
                      ? 'success'
                      : submission.status === 'rejected'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {submission.status === 'accepted'
                    ? 'Zaakceptowane'
                    : submission.status === 'rejected'
                      ? 'Odrzucone'
                      : 'Oczekuje'}
                </Badge>
              </div>
              {submission.rejectionReason ? (
                <p className="mt-2 text-sm text-danger-foreground">{submission.rejectionReason}</p>
              ) : null}
              {roleCan(role, 'bingo.verify') ? (
                <div className="mt-4 space-y-2">
                  <ActionForm action={verifyBingoSubmissionAction}>
                    <input type="hidden" name="weddingId" value={wedding.id} />
                    <input type="hidden" name="submissionId" value={submission.id} />
                    <input type="hidden" name="status" value="accepted" />
                    <SubmitButton size="sm">Akceptuj</SubmitButton>
                  </ActionForm>
                  <ActionForm action={verifyBingoSubmissionAction} className="flex gap-2">
                    <input type="hidden" name="weddingId" value={wedding.id} />
                    <input type="hidden" name="submissionId" value={submission.id} />
                    <input type="hidden" name="status" value="rejected" />
                    <Input
                      name="rejectionReason"
                      required
                      maxLength={300}
                      placeholder="Powód odrzucenia"
                    />
                    <SubmitButton size="sm" variant="outline">
                      Odrzuć
                    </SubmitButton>
                  </ActionForm>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
        {!submissions.length ? (
          <Card className="text-center text-sm text-muted-foreground">
            Brak gotowych zgłoszeń do weryfikacji.
          </Card>
        ) : null}
      </section>

      <section>
        <h3 className="mb-3 text-lg font-semibold">Podsumowanie uczestników</h3>
        <div className="space-y-3">
          {[...grouped.entries()].map(([sessionId, rows]) => {
            const accepted = rows.filter((row) => row.submission.status === 'accepted').length;
            const pending = rows.filter((row) => row.submission.status === 'pending').length;
            const rejected = rows.filter((row) => row.submission.status === 'rejected').length;
            const state = bingoProgress({
              taskCount: tasks.length,
              submittedCount: rows.length,
              acceptedCount: accepted,
              pendingCount: pending,
              rejectedCount: rejected,
            });
            return (
              <Card key={sessionId} className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {rows[0]?.guestName || 'Gość'} · {sessionId.slice(0, 8)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    zdjęcia {rows.length}/{tasks.length} · zaakceptowane {accepted} · oczekujące{' '}
                    {pending} · odrzucone {rejected}
                  </p>
                </div>
                <Badge
                  tone={
                    state === 'completed'
                      ? 'success'
                      : state === 'needs_correction'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {STATUS_LABELS[state]}
                </Badge>
              </Card>
            );
          })}
          {!grouped.size ? (
            <Card className="text-center text-sm text-muted-foreground">
              Nikt jeszcze nie rozpoczął Bingo.
            </Card>
          ) : null}
        </div>
      </section>
    </div>
  );
}
