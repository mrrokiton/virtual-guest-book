'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  contentTypeOf,
  preparePhoto,
  readVideoDuration,
  sendFile,
  sleep,
  UploadError,
  type UploadTarget,
} from './upload';

const CONCURRENCY = 2;
const RETRY_DELAYS_MS = [1000, 3000, 8000, 20000];

export interface UploadLimits {
  maxPhotoBytes: number;
  maxVideoBytes: number;
  maxVideoSeconds: number;
  videoToleranceSeconds: number;
}

export type TaskStatus = 'queued' | 'working' | 'done' | 'error';

export interface UploadTask {
  key: string;
  name: string;
  kind: 'photo' | 'video';
  previewUrl: string | null;
  status: TaskStatus;
  progress: number;
  error?: string;
  mediaId?: string;
}

const MB = 1024 * 1024;

function isVideo(file: File): boolean {
  return contentTypeOf(file).startsWith('video/');
}

export function useUploadQueue(
  slug: string,
  limits: UploadLimits,
  onUploaded: (mediaId: string) => void,
) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const files = useRef(new Map<string, File>());
  /** Media id issued for a task, reused by its retries. */
  const slots = useRef(new Map<string, string>());
  const running = useRef(new Set<string>());
  const onUploadedRef = useRef(onUploaded);
  useEffect(() => {
    onUploadedRef.current = onUploaded;
  }, [onUploaded]);

  const patch = useCallback((key: string, update: Partial<UploadTask>) => {
    setTasks((prev) => prev.map((t) => (t.key === key ? { ...t, ...update } : t)));
  }, []);

  const process = useCallback(
    async (key: string) => {
      const file = files.current.get(key);
      if (!file) return;
      const video = isVideo(file);
      patch(key, { status: 'working', progress: 0, error: undefined });

      try {
        let body: Blob = file;
        let durationSeconds: number | undefined;
        if (video) {
          if (file.size > limits.maxVideoBytes)
            throw new UploadError(
              `Film jest za duży (max ${limits.maxVideoBytes / MB} MB).`,
              false,
            );
          const duration = await readVideoDuration(file);
          if (duration === null) throw new UploadError('Nie udało się odczytać filmu.', false);
          if (duration > limits.maxVideoSeconds + limits.videoToleranceSeconds) {
            throw new UploadError(
              `Film może trwać maksymalnie ${limits.maxVideoSeconds} s.`,
              false,
            );
          }
          durationSeconds = duration;
        } else {
          body = await preparePhoto(file);
          if (body.size > limits.maxPhotoBytes)
            throw new UploadError(
              `Zdjęcie jest za duże (max ${limits.maxPhotoBytes / MB} MB).`,
              false,
            );
        }
        const contentType = body.type || contentTypeOf(file);

        // A failed transfer asks for a fresh upload URL for the same item (so retries do not eat
        // into the gallery limit); once the bytes are stored, only the completion call is retried.
        let uploadedId: string | null = null;
        const attemptOnce = async (): Promise<string> => {
          if (!uploadedId) {
            const started = await api<{ mediaId: string; upload: UploadTarget }>(
              `/api/w/${slug}/uploads`,
              {
                method: 'POST',
                body: JSON.stringify({
                  contentType,
                  size: body.size,
                  durationSeconds,
                  retryOf: slots.current.get(key),
                }),
              },
            );
            slots.current.set(key, started.mediaId);
            await sendFile(started.upload, body, (f) =>
              patch(key, { progress: Math.min(0.97, f) }),
            );
            uploadedId = started.mediaId;
          }
          await api(`/api/w/${slug}/uploads/${uploadedId}/complete`, {
            method: 'POST',
            body: '{}',
          });
          return uploadedId;
        };

        let mediaId: string;
        for (let attempt = 0; ; attempt++) {
          try {
            mediaId = await attemptOnce();
            break;
          } catch (err) {
            const delay = RETRY_DELAYS_MS[attempt];
            if (!(err instanceof UploadError && err.retryable) || delay === undefined) throw err;
            await sleep(delay);
          }
        }
        patch(key, { status: 'done', progress: 1, mediaId });
        onUploadedRef.current(mediaId);
        files.current.delete(key);
        slots.current.delete(key);
      } catch (err) {
        patch(key, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Nie udało się wysłać pliku.',
        });
      }
    },
    [slug, limits, patch],
  );

  useEffect(() => {
    const free = CONCURRENCY - running.current.size;
    if (free <= 0) return;
    const next = tasks
      .filter((t) => t.status === 'queued' && !running.current.has(t.key))
      .slice(0, free);
    for (const t of next) {
      running.current.add(t.key);
      void process(t.key).finally(() => {
        running.current.delete(t.key);
        setTasks((prev) => [...prev]);
      });
    }
  }, [tasks, process]);

  const add = useCallback((list: FileList | File[]) => {
    const added: UploadTask[] = [];
    for (const file of Array.from(list)) {
      const key = crypto.randomUUID();
      files.current.set(key, file);
      const video = isVideo(file);
      added.push({
        key,
        name: file.name,
        kind: video ? 'video' : 'photo',
        previewUrl: video ? null : URL.createObjectURL(file),
        status: 'queued',
        progress: 0,
      });
    }
    setTasks((prev) => [...prev, ...added]);
  }, []);

  const retry = useCallback((key: string) => {
    if (files.current.has(key))
      setTasks((prev) =>
        prev.map((t) => (t.key === key ? { ...t, status: 'queued', error: undefined } : t)),
      );
  }, []);

  const clearFinished = useCallback(() => {
    setTasks((prev) => {
      for (const t of prev) {
        if (t.status === 'done' || t.status === 'error') {
          if (t.previewUrl) URL.revokeObjectURL(t.previewUrl);
          files.current.delete(t.key);
          slots.current.delete(t.key);
        }
      }
      return prev.filter((t) => t.status === 'queued' || t.status === 'working');
    });
  }, []);

  const active = tasks.some((t) => t.status === 'queued' || t.status === 'working');

  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);

  return { tasks, add, retry, clearFinished, active };
}
