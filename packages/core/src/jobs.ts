export const QUEUES = {
  photoProcess: 'photo-process',
  mediaPurge: 'media-purge',
  weddingExport: 'wedding-export',
  weddingPurge: 'wedding-purge',
  deletionReminder: 'deletion-reminder',
  lifecycleTick: 'lifecycle-tick',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface QueueConfig {
  retryLimit: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  retryDelayMax?: number;
  expireInSeconds: number;
  retentionSeconds?: number;
  policy?: 'standard' | 'singleton';
}

/** Shared by web (producer) and worker so whichever starts first creates identical queues. */
export const QUEUE_CONFIG: Record<QueueName, QueueConfig> = {
  [QUEUES.photoProcess]: { retryLimit: 5, retryDelay: 5, retryBackoff: true, expireInSeconds: 120 },
  [QUEUES.mediaPurge]: {
    retryLimit: 10,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 3600,
    expireInSeconds: 120,
  },
  [QUEUES.weddingExport]: { retryLimit: 3, retryDelay: 300, expireInSeconds: 3 * 3600 },
  [QUEUES.weddingPurge]: {
    retryLimit: 10,
    retryDelay: 300,
    retryBackoff: true,
    retryDelayMax: 6 * 3600,
    expireInSeconds: 3600,
  },
  [QUEUES.deletionReminder]: {
    retryLimit: 5,
    retryDelay: 600,
    retentionSeconds: 60 * 86400,
    expireInSeconds: 300,
  },
  [QUEUES.lifecycleTick]: { retryLimit: 0, expireInSeconds: 600, policy: 'singleton' },
};

/** Owners get a last reminder this long before a scheduled purge. */
export const DELETION_REMINDER_DAYS = 3;

export interface PhotoProcessJob {
  weddingId: string;
  mediaId: string;
}

export interface MediaPurgeJob {
  weddingId: string;
  mediaId: string;
}

export interface WeddingExportJob {
  weddingId: string;
  exportId: string;
  notify: boolean;
}

export interface WeddingPurgeJob {
  weddingId: string;
}

export interface DeletionReminderJob {
  weddingId: string;
  /** ISO timestamp; the reminder is dropped if the wedding was restored or rescheduled since. */
  purgeAt: string;
}
