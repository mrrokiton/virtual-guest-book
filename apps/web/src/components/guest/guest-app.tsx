'use client';

import { Camera, Film, ImagePlus, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import type { GalleryItem } from '@/lib/weddings';
import { useGuestUpload } from './guest-upload';
import { GuestHeader, GuestSessionLost } from './guest-header';
import { Lightbox } from './lightbox';
import { useLiveGallery } from './use-live-gallery';

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

export function GuestApp({
  slug,
  headline,
  canUpload,
  uploadClosesAt,
  initialItems,
  initialCursor,
  musicEnabled,
}: {
  slug: string;
  headline: string;
  canUpload: boolean;
  uploadClosesAt: string | null;
  initialItems: GalleryItem[];
  initialCursor: string | null;
  musicEnabled: boolean;
}) {
  const gallery = useLiveGallery(slug, initialItems, initialCursor);
  const uploads = useGuestUpload();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
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
    if (list?.length) uploads.add(list);
  };

  const deleteItem = async (item: GalleryItem) => {
    const res = await fetch(`/api/w/${slug}/media/${item.id}`, { method: 'DELETE' }).catch(
      () => null,
    );
    if (res && (res.ok || res.status === 404)) {
      gallery.removeLocal(item.id);
      uploads.removeMine(item.id);
      setOpenIndex(null);
      return true;
    }
    return false;
  };

  if (gallery.sessionLost) return <GuestSessionLost />;

  return (
    <div className="pb-28">
      <GuestHeader
        slug={slug}
        headline={headline}
        section="photos"
        musicEnabled={musicEnabled}
        degraded={gallery.mode === 'polling'}
      />

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
          canDelete={(item) => uploads.mine.has(item.id)}
          onDelete={deleteItem}
        />
      )}
    </div>
  );
}
