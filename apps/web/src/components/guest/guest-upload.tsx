'use client';

import { CheckCircle2, Film, Loader2, RotateCcw, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useUploadQueue, type UploadLimits, type UploadTask } from './use-upload-queue';

type GuestUploadValue = {
  add: (list: FileList | File[]) => void;
  mine: Set<string>;
  removeMine: (id: string) => void;
};

const GuestUploadContext = createContext<GuestUploadValue | null>(null);

export function useGuestUpload(): GuestUploadValue {
  const value = useContext(GuestUploadContext);
  if (!value) throw new Error('Kolejka wysyłki jest dostępna tylko w strefie gościa.');
  return value;
}

function useMyUploads(slug: string) {
  const storageKey = `vgb:mine:${slug}`;
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

export function GuestUploadProvider({
  slug,
  limits,
  children,
}: {
  slug: string;
  limits: UploadLimits;
  children: ReactNode;
}) {
  const my = useMyUploads(slug);
  const queue = useUploadQueue(slug, limits, my.add);
  const [showQueue, setShowQueue] = useState(true);
  const pathname = usePathname();
  const onMusic = pathname.endsWith('/music');
  const barVisible = queue.tasks.length > 0 && showQueue;
  const done = queue.tasks.filter((t) => t.status === 'done').length;

  const add = useCallback(
    (list: FileList | File[]) => {
      queue.add(list);
      setShowQueue(true);
    },
    [queue],
  );

  return (
    <GuestUploadContext.Provider value={{ add, mine: my.mine, removeMine: my.remove }}>
      <div className={barVisible && onMusic ? 'pb-64' : undefined}>{children}</div>
      {barVisible && (
        <section
          className={
            onMusic
              ? 'fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 mx-auto max-w-md px-3'
              : 'fixed inset-x-0 bottom-24 z-30 mx-auto max-w-md px-3'
          }
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
            {done > 0 && !queue.active && (
              <p className="pb-1 text-xs text-muted-foreground">
                Zdjęcia pojawią się w galerii za chwilę.
              </p>
            )}
            <ul className="divide-y divide-border">
              {queue.tasks.map((task) => (
                <UploadRow key={task.key} task={task} onRetry={() => queue.retry(task.key)} />
              ))}
            </ul>
          </div>
        </section>
      )}
    </GuestUploadContext.Provider>
  );
}
