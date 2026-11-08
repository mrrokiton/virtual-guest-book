import { compareBingoParticipants, evaluateBingo, roleCan, type BingoPhotoState } from '@vgb/core';
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
import { GuestFilter } from './guest-filter';

const STATUS_LABELS = {
  incomplete: 'Nieukończone',
  awaiting_verification: 'Oczekuje na weryfikację',
  needs_correction: 'Wymaga poprawek',
  completed: 'Bingo zaakceptowane',
} as const;

export default async function BingoAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ guest?: string }>;
}) {
  const { id } = await params;
  const { guest } = await searchParams;
  const { wedding, role } = await requireWeddingAccess(id, 'wedding.view');
  const scope = weddingScope(db(), wedding.id);
  const [tasks, submissions, progress] = await Promise.all([
    scope.bingo.tasks.list(),
    scope.bingo.adminSubmissions(),
    scope.bingo.progress(),
  ]);
  const taskIds = tasks.map((task) => task.id);
  const completedAt = new Map(
    progress.map((row) => [row.guestSessionId, row.photosCompletedAt] as const),
  );
  const grouped = new Map<string, typeof submissions>();
  for (const row of submissions) {
    const list = grouped.get(row.submission.guestSessionId) ?? [];
    list.push(row);
    grouped.set(row.submission.guestSessionId, list);
  }

  const participants = [...grouped.entries()]
    .map(([sessionId, rows]) => {
      const photos: BingoPhotoState[] = rows.map((row) => ({
        taskId: row.submission.taskId,
        status: row.submission.status,
        mediaStatus: row.media.status,
        withdrawn: false,
      }));
      const stored = completedAt.get(sessionId) ?? null;
      const evaluation = evaluateBingo({
        taskIds,
        photos,
        previousCompletedAt: stored,
        now: stored ?? new Date(0),
      });
      const name = rows[0]?.guestName || 'Gość';
      return {
        sessionId,
        name,
        label: `${name} · ${sessionId.slice(0, 8)}`,
        rows,
        evaluation,
        completedAt: evaluation.photosComplete ? stored : null,
      };
    })
    .sort((a, b) =>
      compareBingoParticipants(
        {
          name: a.name,
          tasksWithQualifying: a.evaluation.tasksWithQualifying,
          photosCompletedAt: a.completedAt,
        },
        {
          name: b.name,
          tasksWithQualifying: b.evaluation.tasksWithQualifying,
          photosCompletedAt: b.completedAt,
        },
      ),
    );
  const selected = participants.some((person) => person.sessionId === guest) ? (guest ?? '') : '';
  const visible = selected
    ? participants.filter((person) => person.sessionId === selected)
    : participants;

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

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-lg font-semibold">Zgłoszenia</h3>
          <GuestFilter
            guests={participants.map((person) => ({ id: person.sessionId, label: person.label }))}
            selected={selected}
          />
        </div>
        {visible.map((person) => {
          const ready = person.rows.filter((row) => row.media.status === 'ready');
          return (
            <div key={person.sessionId} className="space-y-3">
              <h4 className="font-medium">{person.label}</h4>
              {ready.length ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {ready.map(({ submission, task, media }) => (
                    <Card key={submission.id}>
                      <img
                        src={`/api/w/${wedding.slug}/media/${media.id}/file?v=large`}
                        alt=""
                        className="mb-3 aspect-video w-full rounded-lg bg-muted object-cover"
                      />
                      <CardTitle>{task.body}</CardTitle>
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
                        <p className="mt-2 text-sm text-danger-foreground">
                          {submission.rejectionReason}
                        </p>
                      ) : null}
                      {roleCan(role, 'bingo.verify') ? (
                        <div className="mt-4 space-y-2">
                          <ActionForm notify="toast" action={verifyBingoSubmissionAction}>
                            <input type="hidden" name="weddingId" value={wedding.id} />
                            <input type="hidden" name="submissionId" value={submission.id} />
                            <input type="hidden" name="status" value="accepted" />
                            <SubmitButton size="sm">Akceptuj</SubmitButton>
                          </ActionForm>
                          <ActionForm
                            notify="toast"
                            action={verifyBingoSubmissionAction}
                            className="flex gap-2"
                          >
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
              ) : (
                <Card className="text-center text-sm text-muted-foreground">
                  Brak gotowych zgłoszeń do weryfikacji.
                </Card>
              )}
            </div>
          );
        })}
        {!visible.length ? (
          <Card className="text-center text-sm text-muted-foreground">
            Brak gotowych zgłoszeń do weryfikacji.
          </Card>
        ) : null}
      </section>

      <section>
        <h3 className="mb-3 text-lg font-semibold">Podsumowanie uczestników</h3>
        <div className="space-y-3">
          {participants.map((person) => (
            <Card
              key={person.sessionId}
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <div>
                <p className="font-medium">{person.label}</p>
                <p className="text-sm text-muted-foreground">
                  zadania {person.evaluation.tasksWithQualifying}/{tasks.length} · zaakceptowane{' '}
                  {person.evaluation.acceptedCount} · oczekujące {person.evaluation.pendingCount} ·
                  odrzucone {person.evaluation.rejectedWithoutReplacement}
                </p>
                <p className="text-sm text-muted-foreground">
                  {person.completedAt
                    ? `Komplet zdjęć: ${formatDate(person.completedAt, true)}`
                    : 'Komplet zdjęć nie został jeszcze dodany'}
                </p>
              </div>
              <Badge
                tone={
                  person.evaluation.status === 'completed'
                    ? 'success'
                    : person.evaluation.status === 'needs_correction'
                      ? 'danger'
                      : 'warning'
                }
              >
                {STATUS_LABELS[person.evaluation.status]}
              </Badge>
            </Card>
          ))}
          {!participants.length ? (
            <Card className="text-center text-sm text-muted-foreground">
              Nikt jeszcze nie rozpoczął Bingo.
            </Card>
          ) : null}
        </div>
      </section>
    </div>
  );
}
