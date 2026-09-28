export const PLAN_IDS = ['standard', 'premium'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanLimits {
  maxMediaPerWedding: number;
  maxVideosPerWedding: number;
  maxVideoSeconds: number;
  maxPhotoBytes: number;
  maxVideoBytes: number;
  /** Days between the end of uploads (read_only) and archiving the gallery. */
  galleryDays: number;
  /** Days the archived gallery and the ZIP stay available before automatic deletion. */
  archiveDays: number;
}

const MB = 1024 * 1024;

export const PLANS: Record<PlanId, PlanLimits> = {
  standard: {
    maxMediaPerWedding: 1000,
    maxVideosPerWedding: 30,
    maxVideoSeconds: 30,
    maxPhotoBytes: 25 * MB,
    maxVideoBytes: 200 * MB,
    galleryDays: 90,
    archiveDays: 30,
  },
  premium: {
    maxMediaPerWedding: 5000,
    maxVideosPerWedding: 300,
    maxVideoSeconds: 60,
    maxPhotoBytes: 25 * MB,
    maxVideoBytes: 200 * MB,
    galleryDays: 365,
    archiveDays: 30,
  },
};

/** Browsers report durations a bit off; both the client and the server allow this much. */
export const VIDEO_DURATION_TOLERANCE_S = 1.5;

export function planLimits(plan: PlanId): PlanLimits {
  return PLANS[plan];
}

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}
