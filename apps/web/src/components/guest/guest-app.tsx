'use client';

import {
  Camera,
  CheckCircle2,
  Film,
  ImagePlus,
  Loader2,
  RotateCcw,
  WifiOff,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import type { GalleryItem } from '@/lib/weddings';
import { Lightbox } from './lightbox';
import { useLiveGallery } from './use-live-gallery';
import { useUploadQueue, type UploadLimits, type UploadTask } from './use-upload-queue';

const ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,.heic,.heif,video/mp4,video/quicktime,video/webm';

// Samsung Internet offers the Samsung Gallery for any accept filter, and a file picked there never
// reaches the page; the picker then stays dead until the browser restarts. Without a filter the
// browser offers only Camera and My Files, which work.
const SAMSUNG_ACCEPT = undefined;

const noSubscribe = () => () => {};

function useAcceptAttribute(): string | undefined {
  return useSyncExternalStore(
    noSubscribe,
    () => (/SamsungBrowser/i.test(navigator.userAgent) ? SAMSUNG_ACCEPT : ACCEPT),
    () => ACCEPT,
  );
}

function useMyUploads(slug: string) {
  const storageKey = `vgb:mine:${slug}`;
  // Only read when the lightbox opens, so the server/client difference never reaches the markup.
  const [mine, setMine] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      return new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });

  const update = useCallback(
    (fn: (s: Set<string>) => void) => {
      setMine((prev) => {
        const next = new Set(prev);
        fn(next);
        try {
          localStorage.setItem(storageKey, JSON.stringify([...next].slice(-2000)));
        } catch {
          // Private mode or quota: deleting own uploads just won't survive a reload.
        }
        return next;
      });
    },
    [storageKey],
  );
  return {
    mine,
    add: (id: string) => update((s) => s.add(id)),
    remove: (id: string) => update((s) => s.delete(id)),
  };
}

function formatDuration(s: number | null): string {
  if (!s) return '';
  const total = Math.round(s);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function Tile({ item, onOpen }: { item: GalleryItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative aspect-square overflow-hidden bg-muted"
      aria-label={item.kind === 'video' ? 'Otwórz film' : 'Otwórz zdjęcie'}
    >
      {item.thumbUrl ? (
        <img
          src={item.thumbUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover transition-transform group-hover:scale-105"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <Film className="size-8" />
        </div>
      )}
      {item.kind === 'video' && (
        <span className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
          <Film className="size-3" /> {formatDuration(item.durationSeconds)}
        </span>
      )}
    </button>
  );
}

function UploadRow({ task, onRetry }: { task: UploadTask; onRetry: () => void }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="size-10 shrink-0 overflow-hidden rounded bg-muted">
        {task.previewUrl ? (
          <img src={task.previewUrl} alt="" className="size-full object-cover" />
        ) : (
          <Film className="m-2.5 size-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{task.name}</p>
        {task.status === 'error' ? (
          <p className="text-xs text-destructive">{task.error}</p>
        ) : (
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${Math.round(task.progress * 100)}%` }}
            />
          </div>
        )}
      </div>
      {task.status === 'done' && (
        <CheckCircle2 className="size-5 text-success" aria-label="Wysłano" />
      )}
      {task.status === 'working' && (
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Wysyłanie" />
      )}
      {task.status === 'error' && (
        <Button variant="ghost" size="icon" onClick={onRetry} aria-label="Spróbuj ponownie">
          <RotateCcw className="size-4" />
        </Button>
      )}
    </li>
  );
}

export function GuestApp({
  slug,
  headline,
  canUpload,
  uploadClosesAt,
  limits,
  initialItems,
  initialCursor,
}: {
  slug: string;
  headline: string;
  canUpload: boolean;
  uploadClosesAt: string | null;
  limits: UploadLimits;
  initialItems: GalleryItem[];
  initialCursor: string | null;
}) {
  const gallery = useLiveGallery(slug, initialItems, initialCursor);
  const my = useMyUploads(slug);
  const queue = useUploadQueue(slug, limits, my.add);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [showQueue, setShowQueue] = useState(true);
  const accept = useAcceptAttribute();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const { loadMore, hasMore } = gallery;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => entries[0]?.isIntersecting && void loadMore(),
      { rootMargin: '600px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, hasMore]);

  const onFiles = (list: FileList | null) => {
    if (list?.length) {
      queue.add(list);
      setShowQueue(true);
    }
  };

  const deleteItem = async (item: GalleryItem) => {
    const res = await fetch(`/api/w/${slug}/media/${item.id}`, { method: 'DELETE' }).catch(
      () => null,
    );
    if (res && (res.ok || res.status === 404)) {
      gallery.removeLocal(item.id);
      my.remove(item.id);
      setOpenIndex(null);
      return true;
    }
    return false;
  };

  const done = queue.tasks.filter((t) => t.status === 'done').length;
  const processingNote = done > 0 && !queue.active;

  if (gallery.sessionLost) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="font-serif text-2xl">Sesja wygasła</h1>
        <p className="text-muted-foreground">
          PIN mógł zostać zmieniony. Podaj go ponownie, aby wrócić do galerii.
        </p>
        <Button onClick={() => window.location.reload()}>Wpisz PIN</Button>
      </main>
    );
  }

  return (
    <div className="pb-28">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <h1 className="truncate font-serif text-xl">{headline}</h1>
          {gallery.mode === 'polling' && (
            <span
              className="flex items-center gap-1 text-xs text-muted-foreground"
              title="Galeria odświeża się co kilkanaście sekund"
            >
              <WifiOff className="size-3.5" /> Tryb oszczędny
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl">
        {!canUpload && (
          <Alert className="m-4">
            Dodawanie zdjęć jest już zamknięte. Galerię możesz nadal oglądać.
          </Alert>
        )}
        {canUpload && uploadClosesAt && (
          <p className="px-4 pt-3 text-center text-xs text-muted-foreground">
            Możesz dodawać zdjęcia do{' '}
            {new Date(uploadClosesAt).toLocaleString('pl-PL', {
              dateStyle: 'long',
              timeStyle: 'short',
            })}
          </p>
        )}

        {gallery.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-24 text-center text-muted-foreground">
            <ImagePlus className="size-10" />
            <p>Jeszcze nic tu nie ma. Dodaj pierwsze zdjęcie!</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-0.5 pt-3 sm:grid-cols-4 lg:grid-cols-6">
            {gallery.items.map((item, i) => (
              <Tile key={item.id} item={item} onOpen={() => setOpenIndex(i)} />
            ))}
          </div>
        )}
        <div ref={sentinel} className="h-10" />
        {gallery.loadingMore && (
          <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
        )}
      </main>

      {queue.tasks.length > 0 && showQueue && (
        <section
          className="fixed inset-x-0 bottom-24 z-30 mx-auto max-w-md px-3"
          aria-live="polite"
        >
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-card px-4 py-2 shadow-lg">
            <div className="flex items-center justify-between py-1">
              <p className="text-sm font-medium">
                {queue.active
                  ? `Wysyłanie… (${done}/${queue.tasks.length})`
                  : `Wysłano ${done} z ${queue.tasks.length}`}
              </p>
              {!queue.active && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    queue.clearFinished();
                    setShowQueue(false);
                  }}
                  aria-label="Zamknij"
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
            {processingNote && (
              <p className="pb-1 text-xs text-muted-foreground">
                Zdjęcia pojawią się w galerii za chwilę.
              </p>
            )}
            <ul className="divide-y divide-border">
              {queue.tasks.map((t) => (
                <UploadRow key={t.key} task={t} onRetry={() => queue.retry(t.key)} />
              ))}
            </ul>
          </div>
        </section>
      )}

      {canUpload && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto flex max-w-md gap-2">
            <Button size="lg" className="flex-1" onClick={() => inputRef.current?.click()}>
              <ImagePlus className="size-5" /> Dodaj zdjęcia lub filmy
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => cameraRef.current?.click()}
              aria-label="Zrób zdjęcie"
            >
              <Camera className="size-5" />
            </Button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple
            hidden
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {openIndex !== null && gallery.items[openIndex] && (
        <Lightbox
          slug={slug}
          items={gallery.items}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          canDelete={(item) => my.mine.has(item.id)}
          onDelete={deleteItem}
        />
      )}
    </div>
  );
}
