'use client';

import { evaluateBingo, taskTileStatus, type BingoTileStatus } from '@vgb/core';
import { Camera, CheckCircle2, Clock3, ImagePlus, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ToastProvider, useToast } from '@/components/ui/toast';
import type { GuestBingoData, GuestBingoSubmission } from '@/lib/bingo';
import { useGuestUpload } from './guest-upload';
import { GuestHeader, GuestSessionLost } from './guest-header';
import type { LiveWindow } from './live-schedule';
import { useLiveUpdates } from './use-live-updates';

const TILE_LABEL: Record<BingoTileStatus, string> = {
  todo: 'Do wykonania',
  processing: 'Zdjęcie jest przetwarzane',
  failed: 'Wysyłanie nie powiodło się',
  pending: 'Oczekuje na weryfikację',
  accepted: 'Zdjęcie zaakceptowane',
  rejected: 'Zdjęcie odrzucone',
};

const PHOTO_LABEL: Record<string, string> = {
  uploading: 'Wysyłanie',
  processing: 'Przetwarzanie',
  failed: 'Błąd',
  pending: 'Oczekuje',
  accepted: 'Zaakceptowane',
  rejected: 'Odrzucone',
};

export function BingoView(props: {
  slug: string;
  headline: string;
  liveWindow: LiveWindow;
  initial: GuestBingoData;
  musicEnabled: boolean;
}) {
  return (
    <ToastProvider>
      <BingoBoard {...props} />
    </ToastProvider>
  );
}

function BingoBoard({
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
  const router = useRouter();
  const upload = useGuestUpload();
  const toast = useToast();
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const seenReady = useRef(
    new Set(
      initial.tasks.flatMap((task) =>
        task.submissions.filter((item) => item.mediaStatus === 'ready').map((item) => item.id),
      ),
    ),
  );

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

  useEffect(() => {
    const ready = data.tasks.flatMap((task) =>
      task.submissions.filter((item) => item.mediaStatus === 'ready').map((item) => item.id),
    );
    const fresh = ready.filter((id) => !seenReady.current.has(id));
    for (const id of ready) seenReady.current.add(id);
    if (fresh.length) toast?.push('Zdjęcie dodane.');
  }, [data, toast]);

  const remove = async (mediaId: string) => {
    if (!window.confirm('Usunąć to zdjęcie? Status weryfikacji zostanie wyzerowany.')) return;
    const res = await fetch(`/api/w/${slug}/media/${mediaId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      toast?.push('Nie udało się usunąć zdjęcia.', 'danger');
      return;
    }
    await refresh();
    toast?.push('Zdjęcie usunięte.');
  };

  const saveName = async (form: FormData) => {
    const displayName = String(form.get('displayName') ?? '').trim();
    const res = await fetch(`/api/w/${slug}/bingo/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
    if (!res.ok) {
      toast?.push('Nie udało się zapisać imienia.', 'danger');
      return;
    }
    await refresh();
    toast?.push('Imię zapisane.');
  };

  if (sessionLost) return <GuestSessionLost />;
  const evaluation = evaluateBingo({
    taskIds: data.tasks.map((task) => task.id),
    photos: data.tasks.flatMap((task) =>
      task.submissions.map((item) => ({
        taskId: task.id,
        status: item.status,
        mediaStatus: item.mediaStatus,
        withdrawn: false,
      })),
    ),
    previousCompletedAt: null,
    now: new Date(),
  });

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
          const tile = taskTileStatus(
            task.submissions.map((item) => ({
              taskId: task.id,
              status: item.status,
              mediaStatus: item.mediaStatus,
              withdrawn: false,
            })),
          );
          return (
            <Card key={task.id} className="pb-4">
              <div className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                  {index + 1}
                </span>
                <p className="min-w-0 flex-1 font-medium">{task.body}</p>
              </div>
              {task.submissions.length ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {task.submissions.map((item) => (
                    <PhotoThumb
                      key={item.id}
                      item={item}
                      onRemove={() => void remove(item.mediaId)}
                    />
                  ))}
                </div>
              ) : null}
              {data.canUpload && data.displayName ? (
                <div className="mt-3">
                  <Button variant="outline" onClick={() => inputs.current.get(task.id)?.click()}>
                    {task.submissions.length ? (
                      <Camera className="size-4" />
                    ) : (
                      <ImagePlus className="size-4" />
                    )}
                    {task.submissions.length ? 'Dodaj kolejne zdjęcie' : 'Dodaj zdjęcie'}
                  </Button>
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
                        upload.add(event.target.files, { bingoTaskId: task.id });
                      }
                      event.target.value = '';
                    }}
                  />
                </div>
              ) : null}
              <div className="mt-4 flex justify-end">
                <TileBadge status={tile} />
              </div>
            </Card>
          );
        })}

        {evaluation.photosComplete && !evaluation.bingoAccepted ? (
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
        {evaluation.bingoAccepted ? (
          <Alert tone="success">
            <p className="font-medium">Bingo ukończone!</p>
            Wszystkie zadania zostały zaakceptowane.
          </Alert>
        ) : null}
      </main>
    </div>
  );
}

function PhotoThumb({ item, onRemove }: { item: GuestBingoSubmission; onRemove: () => void }) {
  const label =
    item.mediaStatus === 'ready' ? PHOTO_LABEL[item.status] : PHOTO_LABEL[item.mediaStatus];
  const tone =
    item.mediaStatus === 'failed' || item.status === 'rejected'
      ? 'danger'
      : item.status === 'accepted' && item.mediaStatus === 'ready'
        ? 'success'
        : 'warning';
  return (
    <div>
      <div className="relative">
        {item.thumbUrl ? (
          <img src={item.thumbUrl} alt="" className="aspect-video w-full rounded-lg object-cover" />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
            {label ?? 'Zdjęcie'}
          </div>
        )}
        {item.thumbUrl ? (
          <Badge tone={tone} className="absolute right-1 bottom-1">
            {label}
          </Badge>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-1 right-1 bg-card/80"
          onClick={onRemove}
          aria-label="Usuń zdjęcie"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      {item.rejectionReason ? (
        <p className="mt-1 text-xs text-danger-foreground">{item.rejectionReason}</p>
      ) : null}
    </div>
  );
}

function TileBadge({ status }: { status: BingoTileStatus }) {
  const tone =
    status === 'accepted'
      ? 'success'
      : status === 'rejected' || status === 'failed'
        ? 'danger'
        : status === 'todo'
          ? 'neutral'
          : 'warning';
  return (
    <Badge tone={tone}>
      {status === 'processing' ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
      {status === 'accepted' ? <CheckCircle2 className="mr-1 size-3" /> : null}
      {status === 'rejected' || status === 'failed' ? <RotateCcw className="mr-1 size-3" /> : null}
      {status === 'pending' ? <Clock3 className="mr-1 size-3" /> : null}
      {TILE_LABEL[status]}
    </Badge>
  );
}
