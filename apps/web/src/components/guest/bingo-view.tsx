'use client';

import { Camera, CheckCircle2, Clock3, ImagePlus, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { GuestBingoData } from '@/lib/bingo';
import { useGuestUpload } from './guest-upload';
import { GuestHeader, GuestSessionLost } from './guest-header';
import type { LiveWindow } from './live-schedule';
import { useLiveUpdates } from './use-live-updates';

export function BingoView({
  slug,
  headline,
  liveWindow,
  initial,
  musicEnabled,
}: {
  slug: string;
  headline: string;
  liveWindow: LiveWindow;
  initial: GuestBingoData;
  musicEnabled: boolean;
}) {
  const [data, setData] = useState(initial);
  const [sessionLost, setSessionLost] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const upload = useGuestUpload();
  const inputs = useRef(new Map<string, HTMLInputElement>());

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/w/${slug}/bingo`, { cache: 'no-store' }).catch(() => null);
    if (!res) return;
    if (res.status === 401) return setSessionLost(true);
    if (res.status === 404) return router.push(`/w/${slug}`);
    if (res.ok) setData((await res.json()) as GuestBingoData);
  }, [slug, router]);
  const mode = useLiveUpdates(slug, liveWindow, refresh, {
    'bingo.changed': refresh,
    'media.ready': refresh,
    'media.removed': refresh,
    resync: refresh,
  });

  const remove = async (mediaId: string) => {
    if (!window.confirm('Usunąć to zdjęcie? Status weryfikacji zostanie wyzerowany.')) return;
    const res = await fetch(`/api/w/${slug}/media/${mediaId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      setError('Nie udało się usunąć zdjęcia.');
      return;
    }
    await refresh();
  };

  const saveName = async (form: FormData) => {
    const displayName = String(form.get('displayName') ?? '').trim();
    const res = await fetch(`/api/w/${slug}/bingo/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
    if (!res.ok) {
      setError('Nie udało się zapisać imienia.');
      return;
    }
    await refresh();
  };

  if (sessionLost) return <GuestSessionLost />;
  const readyCount = data.tasks.filter((task) => task.submission?.mediaStatus === 'ready').length;
  const allAccepted =
    data.tasks.length > 0 && data.tasks.every((task) => task.submission?.status === 'accepted');

  return (
    <div className="pb-24">
      <GuestHeader
        slug={slug}
        headline={headline}
        section="bingo"
        musicEnabled={musicEnabled}
        bingoEnabled
        degraded={mode === 'polling'}
      />
      <main className="mx-auto max-w-lg space-y-4 px-4 py-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {!data.displayName ? (
          <Card>
            <h2 className="font-serif text-xl">Jak mamy Cię podpisać?</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Nazwa jest potrzebna, aby Para Młoda mogła rozpoznać Twój postęp.
            </p>
            <form action={saveName} className="flex gap-2">
              <Input name="displayName" required maxLength={60} placeholder="Twoje imię" />
              <Button type="submit">Zapisz</Button>
            </form>
          </Card>
        ) : null}

        {data.tasks.map((task, index) => {
          const submission = task.submission;
          const processing =
            submission &&
            (submission.mediaStatus === 'uploading' || submission.mediaStatus === 'processing');
          const failed = submission?.mediaStatus === 'failed';
          const status = !submission
            ? 'Do wykonania'
            : processing
              ? 'Zdjęcie jest przetwarzane'
              : failed
                ? 'Wysyłanie nie powiodło się'
                : submission.status === 'accepted'
                  ? 'Zdjęcie zaakceptowane'
                  : submission.status === 'rejected'
                    ? 'Zdjęcie odrzucone'
                    : 'Oczekuje na weryfikację';
          return (
            <Card key={task.id}>
              <div className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{task.body}</p>
                  <div className="mt-2">
                    <Badge
                      tone={
                        submission?.status === 'accepted'
                          ? 'success'
                          : submission?.status === 'rejected' || failed
                            ? 'danger'
                            : submission
                              ? 'warning'
                              : 'neutral'
                      }
                    >
                      {processing ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
                      {submission?.status === 'accepted' ? (
                        <CheckCircle2 className="mr-1 size-3" />
                      ) : submission?.status === 'rejected' || failed ? (
                        <RotateCcw className="mr-1 size-3" />
                      ) : submission ? (
                        <Clock3 className="mr-1 size-3" />
                      ) : null}
                      {status}
                    </Badge>
                  </div>
                </div>
              </div>
              {submission?.thumbUrl ? (
                <img
                  src={submission.thumbUrl}
                  alt=""
                  className="mt-3 aspect-video w-full rounded-lg bg-muted object-cover"
                />
              ) : null}
              {submission?.rejectionReason ? (
                <Alert tone="danger" className="mt-3">
                  {submission.rejectionReason}
                </Alert>
              ) : null}
              {data.canUpload && data.displayName ? (
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => inputs.current.get(task.id)?.click()}
                    disabled={Boolean(processing)}
                  >
                    {submission ? <Camera className="size-4" /> : <ImagePlus className="size-4" />}
                    {submission ? 'Zmień zdjęcie' : 'Dodaj zdjęcie'}
                  </Button>
                  {submission ? (
                    <Button
                      variant="ghost"
                      onClick={() => void remove(submission.mediaId)}
                      aria-label="Usuń zdjęcie"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                  <input
                    ref={(node) => {
                      if (node) inputs.current.set(task.id, node);
                    }}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    onChange={(event) => {
                      if (event.target.files?.length) {
                        upload.add(event.target.files, {
                          bingoTaskId: task.id,
                          replaceSubmissionId: submission?.id,
                        });
                      }
                      event.target.value = '';
                    }}
                  />
                </div>
              ) : null}
            </Card>
          );
        })}

        {data.tasks.length > 0 && readyCount === data.tasks.length && !allAccepted ? (
          <Alert>
            <p className="font-medium">Wszystkie zdjęcia zostały dodane!</p>
            <p className="mt-1">
              Zgłoś się do jednej z poniższych osób, aby zweryfikować wykonanie zadań:
            </p>
            <ul className="mt-2 list-disc pl-5">
              {data.validators.map((person) => (
                <li key={person.id}>
                  {person.fullName}
                  {person.nickname ? ` „${person.nickname}”` : ''}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {allAccepted ? (
          <Alert tone="success">
            <p className="font-medium">Bingo ukończone!</p>
            Wszystkie zadania zostały zaakceptowane.
          </Alert>
        ) : null}
      </main>
    </div>
  );
}
