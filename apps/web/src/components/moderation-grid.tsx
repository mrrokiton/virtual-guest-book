'use client';

import { Check, EyeOff, Film } from 'lucide-react';
import { useActionState, useState } from 'react';
import { moderateMediaAction } from '@/app/dashboard/actions';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { initialActionState } from '@/lib/action-state';
import { cn } from '@/lib/utils';
import type { GalleryItem } from '@/lib/weddings';

export type ModerationItem = GalleryItem & { fullUrl: string | null };

const STATUS_NOTE: Partial<Record<GalleryItem['status'], string>> = {
  hidden: 'Ukryte',
  processing: 'Przetwarzanie',
  failed: 'Błąd pliku',
};

export function ModerationGrid({
  weddingId,
  items,
  canModerate,
}: {
  weddingId: string;
  items: ModerationItem[];
  canModerate: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: typeof initialActionState, form: FormData) => {
      const result = await moderateMediaAction(prev, form);
      if (result.ok) {
        setSelected(new Set());
        setConfirmDelete(false);
      }
      return result;
    },
    initialActionState,
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chosen = items.filter((i) => selected.has(i.id));
  const anyReady = chosen.some((i) => i.status === 'ready');
  const anyHidden = chosen.some((i) => i.status === 'hidden');

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="weddingId" value={weddingId} />
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="mediaId" value={id} />
      ))}

      {canModerate && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
          <span className="px-2 text-sm">
            {selected.size ? `Zaznaczono: ${selected.size}` : 'Kliknij miniatury, aby zaznaczyć'}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {selected.size > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Odznacz
              </Button>
            )}
            <Button
              type="submit"
              name="op"
              value="hide"
              size="sm"
              variant="outline"
              disabled={!anyReady || pending}
            >
              Ukryj
            </Button>
            <Button
              type="submit"
              name="op"
              value="unhide"
              size="sm"
              variant="outline"
              disabled={!anyHidden || pending}
            >
              Przywróć
            </Button>
            {confirmDelete ? (
              <Button
                type="submit"
                name="op"
                value="delete"
                size="sm"
                variant="destructive"
                disabled={!selected.size || pending}
              >
                Usuń trwale ({selected.size})
              </Button>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                disabled={!selected.size || pending}
                onClick={() => setConfirmDelete(true)}
              >
                Usuń…
              </Button>
            )}
          </div>
        </div>
      )}
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.ok && <Alert tone="success">{state.ok}</Alert>}

      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {items.map((item) => {
          const isSelected = selected.has(item.id);
          const note = STATUS_NOTE[item.status];
          return (
            <li key={item.id} className="space-y-1">
              <button
                type="button"
                disabled={!canModerate}
                onClick={() => toggle(item.id)}
                aria-pressed={isSelected}
                className={cn(
                  'relative block aspect-square w-full overflow-hidden rounded-md bg-muted outline-offset-2',
                  isSelected && 'outline-3 outline-primary',
                  item.status === 'hidden' && 'opacity-50',
                )}
              >
                {item.thumbUrl ? (
                  <img
                    src={item.thumbUrl}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <Film className="m-auto size-8 text-muted-foreground" />
                )}
                {isSelected && (
                  <span className="absolute top-1.5 right-1.5 rounded-full bg-primary p-0.5 text-primary-foreground">
                    <Check className="size-4" />
                  </span>
                )}
                {note && (
                  <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
                    {item.status === 'hidden' && <EyeOff className="size-3" />} {note}
                  </span>
                )}
              </button>
              <div className="flex items-center justify-between gap-1 text-xs text-muted-foreground">
                <span className="truncate">{item.uploaderName ?? 'Gość'}</span>
                {(item.fullUrl ?? item.largeUrl) && (
                  <a
                    href={item.fullUrl ?? item.largeUrl!}
                    target="_blank"
                    rel="noopener"
                    className="shrink-0 underline"
                  >
                    Otwórz
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </form>
  );
}
