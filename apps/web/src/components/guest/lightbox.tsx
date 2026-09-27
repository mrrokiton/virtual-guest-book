'use client';

import { ChevronLeft, ChevronRight, Download, Loader2, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { GalleryItem } from '@/lib/weddings';

type Playback = { type: 'iframe'; url: string } | { type: 'file'; url: string };

const SWIPE_PX = 50;

function VideoPlayer({ slug, item }: { slug: string; item: GalleryItem }) {
  const [playback, setPlayback] = useState<Playback | null | 'error'>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/w/${slug}/media/${item.id}/file?v=play`, { cache: 'no-store' })
      .then((r) =>
        r.ok ? (r.json() as Promise<Playback>) : Promise.reject(new Error(String(r.status))),
      )
      .then((p) => !cancelled && setPlayback(p))
      .catch(() => !cancelled && setPlayback('error'));
    return () => {
      cancelled = true;
    };
  }, [slug, item.id]);

  if (playback === null) return <Loader2 className="size-8 animate-spin text-white" />;
  if (playback === 'error') return <p className="text-white">Nie udało się wczytać filmu.</p>;
  if (playback.type === 'iframe') {
    return (
      <iframe
        src={playback.url}
        title="Film"
        className="aspect-video w-full max-w-4xl border-0"
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    );
  }
  return (
    <video src={playback.url} controls autoPlay playsInline className="max-h-full max-w-full" />
  );
}

export function Lightbox({
  slug,
  items,
  index,
  onIndexChange,
  onClose,
  canDelete,
  onDelete,
}: {
  slug: string;
  items: GalleryItem[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  canDelete: (item: GalleryItem) => boolean;
  onDelete: (item: GalleryItem) => Promise<boolean>;
}) {
  const item = items[index];
  const touchX = useRef<number | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const confirming = item !== undefined && confirmingId === item.id;
  const setConfirming = (on: boolean) => setConfirmingId(on && item ? item.id : null);

  const prev = () => index > 0 && onIndexChange(index - 1);
  const next = () => index < items.length - 1 && onIndexChange(index + 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1);
      if (e.key === 'ArrowRight' && index < items.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [index, items.length, onClose, onIndexChange]);

  if (!item) return null;
  const fileBase = `/api/w/${slug}/media/${item.id}/file`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.kind === 'video' ? 'Film' : 'Zdjęcie'}
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const start = touchX.current;
        const end = e.changedTouches[0]?.clientX;
        touchX.current = null;
        if (start === null || end === undefined) return;
        if (end - start > SWIPE_PX) prev();
        if (start - end > SWIPE_PX) next();
      }}
    >
      <div className="flex items-center justify-between gap-2 p-2 text-white">
        <p className="truncate px-2 text-sm text-white/80">
          {item.uploaderName ? `Dodał(a): ${item.uploaderName}` : ''}
        </p>
        <div className="flex items-center gap-1">
          {item.kind === 'photo' && (
            <a
              href={`${fileBase}?v=full`}
              target="_blank"
              rel="noopener"
              className="rounded-lg p-2.5 hover:bg-white/10"
              aria-label="Pobierz w pełnej jakości"
            >
              <Download className="size-5" />
            </a>
          )}
          {canDelete(item) &&
            (confirming ? (
              <Button
                variant="destructive"
                size="sm"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  const ok = await onDelete(item);
                  setDeleting(false);
                  if (!ok) setConfirming(false);
                }}
              >
                {deleting ? 'Usuwanie…' : 'Usuń na pewno'}
              </Button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-lg p-2.5 hover:bg-white/10"
                aria-label="Usuń moje zdjęcie"
              >
                <Trash2 className="size-5" />
              </button>
            ))}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2.5 hover:bg-white/10"
            aria-label="Zamknij"
          >
            <X className="size-6" />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4">
        {item.kind === 'photo' ? (
          item.largeUrl ? (
            <img
              key={item.id}
              src={item.largeUrl}
              alt=""
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <p className="text-white">Zdjęcie jest jeszcze przetwarzane.</p>
          )
        ) : (
          <VideoPlayer key={item.id} slug={slug} item={item} />
        )}

        {index > 0 && (
          <button
            type="button"
            onClick={prev}
            className="absolute top-1/2 left-2 hidden -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 sm:block"
            aria-label="Poprzednie"
          >
            <ChevronLeft className="size-6" />
          </button>
        )}
        {index < items.length - 1 && (
          <button
            type="button"
            onClick={next}
            className="absolute top-1/2 right-2 hidden -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 sm:block"
            aria-label="Następne"
          >
            <ChevronRight className="size-6" />
          </button>
        )}
      </div>
    </div>
  );
}
