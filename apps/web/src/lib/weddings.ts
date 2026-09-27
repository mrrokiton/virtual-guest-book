import { decryptSecret, type WeddingStatus } from '@vgb/core';
import type { Media, Wedding } from '@vgb/db';
import { env } from './env';

export const STATUS_LABELS: Record<WeddingStatus, string> = {
  draft: 'Szkic',
  active: 'Aktywne',
  read_only: 'Tylko do odczytu',
  archived: 'Zarchiwizowane',
  pending_deletion: 'Zaplanowane do usunięcia',
  deleted: 'Usunięte',
};

export const STATUS_TONES: Record<WeddingStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral',
  active: 'success',
  read_only: 'neutral',
  archived: 'warning',
  pending_deletion: 'danger',
  deleted: 'danger',
};

export function guestUrl(slug: string): string {
  return `${env().APP_URL}/w/${slug}`;
}

export function weddingPin(w: Pick<Wedding, 'pinCiphertext'>): string {
  return decryptSecret(w.pinCiphertext, env().PIN_ENCRYPTION_KEY);
}

export function formatPin(pin: string): string {
  return `${pin.slice(0, 3)} ${pin.slice(3)}`;
}

export interface GalleryItem {
  id: string;
  kind: 'photo' | 'video';
  status: Media['status'];
  uploaderName: string | null;
  createdAt: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  thumbUrl: string | null;
  largeUrl: string | null;
}

export function toGalleryItem(slug: string, m: Media, hasVideoThumb: boolean): GalleryItem {
  const base = `/api/w/${slug}/media/${m.id}/file`;
  const isPhoto = m.kind === 'photo';
  return {
    id: m.id,
    kind: m.kind,
    status: m.status,
    uploaderName: m.uploaderName,
    createdAt: m.createdAt.toISOString(),
    width: m.width,
    height: m.height,
    durationSeconds: m.durationSeconds,
    thumbUrl: isPhoto
      ? m.variants.thumb
        ? `${base}?v=thumb`
        : null
      : hasVideoThumb
        ? `${base}?v=thumb`
        : null,
    largeUrl: isPhoto ? (m.variants.large ? `${base}?v=large` : null) : null,
  };
}
